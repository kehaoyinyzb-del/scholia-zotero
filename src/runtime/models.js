import { readAPICatalog } from '../providers/catalog.js';
import { apiModel } from '../domain/api-models.js';
import { GoogleOAuth } from './google-oauth.js';
import { CodexRuntime } from './codex-runtime.js';
import { PersistentCodex } from '../providers/persistent-codex.js';
import { JsonRpcClient } from '../providers/json-rpc.js';
import { initializeCodex, runCodexTurn, codexArguments } from '../providers/codex.js';
import { runChatCompletion } from '../providers/chat.js';
import { ReadingError, errorFeedback } from '../domain/errors.js';
import { apiKeyId, catalogKey, providerSignature } from '../domain/configuration.js';

export class ModelService {
  constructor(environment, store, secrets, rootURI) {
    this.environment = environment;
    this.store = store;
    this.secrets = secrets;
    this.runtime = new CodexRuntime(environment, store, rootURI);
    this.active = new Set();
    this.google = new GoogleOAuth(environment, secrets, rootURI);
    this.selectionPool = new PersistentCodex(
      (provider) => this.connectCodex(provider),
      () => new (this.environment.Zotero.getMainWindow().AbortController)(),
    );
  }

  displayName(provider) {
    const catalog = this.catalogs?.get(catalogKey(provider));
    const match = catalog?.models.find((model) => model.model === provider.model);
    // A per-turn model override changes the signature but uses the same provider catalog.
    const known =
      match ||
      [...(this.catalogs?.values() || [])]
        .flatMap((entry) => entry.models)
        .find((model) => model.model === provider.model);
    return known?.displayName || provider.displayName || provider.model || provider.name;
  }

  async credentials(provider, signal) {
    if (provider.type === 'google-oauth') return this.google.credentials(provider, signal);
    return { key: await this.secrets.get(apiKeyId(provider)) };
  }

  async catalog(provider) {
    this.catalogs ||= new Map();
    const signature = catalogKey(provider);
    if (this.catalogs.has(signature)) return this.catalogs.get(signature);
    const fallback = [apiModel({ id: provider.model || '', name: provider.model || '默认模型' })];
    let connection;
    try {
      let models;
      if (provider.type === 'codex') {
        connection = await this.connectCodex(provider);
        await initializeCodex(connection.client);
        const account = await connection.client.request('account/read', { refreshToken: false });
        if (account.requiresOpenaiAuth && !account.account)
          return { models: fallback, reason: 'Codex 尚未登录，请点击“连接账号”完成登录。' };
        models = [];
        let cursor;
        do {
          const page = await connection.client.request('model/list', { limit: 100, cursor });
          models.push(...page.data);
          cursor = page.nextCursor;
        } while (cursor);
      } else {
        const window = this.environment.Zotero.getMainWindow();
        const signal = window.AbortSignal.timeout(15000);
        if (provider.type === 'google-oauth' && !(await this.google.connected(provider.id)))
          return { models: [], disabled: true, reason: '请登录 Google 账号' };
        const credentials = await this.credentials(provider, signal);
        if (!credentials.key) return { models: [], disabled: true, reason: '未配置密钥' };
        models = await readAPICatalog(provider, {
          fetch: window.fetch.bind(window),
          ...credentials,
          signal,
        });
      }
      if (provider.type !== 'codex' && !models.some((entry) => entry.model === provider.model))
        models.unshift(...fallback);
      const result = { models: models.length ? models : fallback };
      this.catalogs.set(signature, result);
      return result;
    } catch (error) {
      const reason =
        error.code === 'login'
          ? 'Codex 尚未登录，请点击“连接账号”。'
          : error.details?.rpcCode === -32601
            ? '当前 CLI 不支持模型列表，请升级 Codex。'
            : error.code === 'timeout'
              ? '读取模型列表超时，请稍后重试。'
              : error.code === 'executable'
                ? '未找到 Codex，请在设置中检查路径。'
                : provider.type === 'codex'
                  ? '无法读取 Codex 模型列表；请确认已登录且 CLI 为新版。仍可尝试默认模型。'
                  : '模型列表暂不可用，使用设置中填写的模型。';
      return { models: fallback, reason, error: errorFeedback(error, provider.type) };
    } finally {
      await connection?.close();
    }
  }

  executable(provider) {
    return this.runtime.discover(provider);
  }

  async run(provider, request, { signal, onText }) {
    const window = this.environment.Zotero.getMainWindow();
    const controller = new window.AbortController();
    const forwardAbort = () => controller.abort();
    signal.addEventListener('abort', forwardAbort, { once: true });
    if (signal.aborted) controller.abort();
    this.active.add(controller);
    let expired = false;
    const expire = () => {
      expired = true;
      controller.abort();
    };
    // The configured timeout measures silence, so long answers that keep streaming are not cut
    // off; a hard ceiling still bounds a request that streams forever.
    const idle = this.store.configuration().timeout;
    let timer = setTimeout(expire, idle);
    const ceiling = setTimeout(expire, Math.max(idle, 600000));
    const streamed = (text) => {
      clearTimeout(timer);
      timer = setTimeout(expire, idle);
      onText?.(text);
    };
    try {
      if (provider.type === 'codex') {
        return await this.codex(provider, request, controller.signal, streamed);
      }
      return await runChatCompletion(provider, request, {
        fetch: window.fetch.bind(window),
        ...(await this.credentials(provider, controller.signal)),
        signal: controller.signal,
        onText: streamed,
      });
    } catch (error) {
      if (expired) throw new ReadingError('timeout');
      if (controller.signal.aborted) throw new ReadingError('cancelled');
      throw error;
    } finally {
      clearTimeout(timer);
      clearTimeout(ceiling);
      signal.removeEventListener('abort', forwardAbort);
      this.active.delete(controller);
    }
  }

  async connectCodex(provider) {
    const { ChromeUtils, IOUtils, PathUtils } = this.environment;
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const directory = PathUtils.join(this.store.directory, 'codex-runtime');
    await IOUtils.makeDirectory(directory, { permissions: 0o700, ignoreExisting: true });
    const path = await this.executable(provider);
    const process = await Subprocess.call({
      command: path,
      environment: await this.runtime.processEnvironment(path),
      environmentAppend: true,
      arguments: codexArguments,
      workdir: directory,
      stderr: 'pipe',
    });
    const client = new JsonRpcClient((line) => process.stdin.write(line));
    const drain = async (pipe, consumer) => {
      let chunk;
      while ((chunk = await pipe.readString())) consumer?.(chunk);
    };
    const stdout = drain(process.stdout, (chunk) => client.receive(chunk));
    let incompatible = false;
    const stderr = drain(process.stderr, (text) => {
      if (/unrecognized subcommand.*app-server|unexpected argument.*listen/iu.test(text))
        incompatible = true;
    });
    const exited = process
      .wait()
      .then(() => client.close(new ReadingError(incompatible ? 'codex-old' : 'connection')));
    let closed = false;
    return {
      client,
      directory,
      pid: process.pid,
      close: async () => {
        if (closed) return;
        closed = true;
        client.close();
        process.kill();
        await Promise.allSettled([stdout, stderr, exited]);
      },
    };
  }

  async codex(provider, request, signal, onText) {
    if (signal.aborted) throw new ReadingError('cancelled');
    const connection = await this.connectCodex(provider);
    let killTimer;
    const forceExit = () => {
      killTimer = setTimeout(() => connection.close(), 1500);
    };
    signal.addEventListener('abort', forceExit, { once: true });
    try {
      if (signal.aborted) throw new ReadingError('cancelled');
      await initializeCodex(connection.client);
      return await runCodexTurn(connection.client, request, {
        provider,
        directory: connection.directory,
        signal,
        onText,
        effort: provider.effort,
        onModel: (model) => {
          request.actualModel = model;
        },
      });
    } catch (error) {
      if (['quota', 'rate'].includes(error.code)) {
        try {
          const limits = await connection.client.request('account/rateLimits/read', {});
          const snapshots = [limits.rateLimits, ...Object.values(limits.rateLimitsByLimitId || {})];
          const resets = snapshots
            .flatMap((entry) => [entry?.primary, entry?.secondary])
            .filter((entry) => entry?.usedPercent >= 100 && entry.resetsAt * 1000 > Date.now())
            .map((entry) => entry.resetsAt * 1000);
          if (resets.length) error.details.resetAt = Math.min(...resets);
        } catch {
          /* Older servers may not expose reset metadata. */
        }
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', forceExit);
      clearTimeout(killTimer);
      await connection.close();
    }
  }

  selectionProvider() {
    const configuration = this.store.configuration();
    return configuration.providers.find(
      (entry) => entry.id === (configuration.routes.selection || configuration.routes.translate),
    );
  }

  async prewarmSelection() {
    const provider = this.selectionProvider();
    if (provider?.type !== 'codex' || this.store.configuration().translation?.trigger === 'off')
      return;
    const signature = providerSignature(provider);
    if (this.prewarmFailure === signature) return;
    try {
      await this.selectionPool.ensure(provider);
    } catch (error) {
      this.prewarmFailure = signature;
      throw error;
    }
  }

  async translateSelection(provider, request, options) {
    if (!provider) throw new ReadingError('unconfigured');
    if (provider.type !== 'codex') return this.run(provider, request, options);
    const timeout = setTimeout(
      () => options.controller.abort(),
      this.store.configuration().timeout,
    );
    this.active.add(options.controller);
    try {
      const result = await this.selectionPool.run(provider, request, options);
      this.prewarmFailure = null;
      return result;
    } finally {
      clearTimeout(timeout);
      this.active.delete(options.controller);
    }
  }

  async probe(provider, signal, key) {
    const window = this.environment.Zotero.getMainWindow();
    const run = (request) =>
      key === undefined
        ? this.run(provider, request, { signal })
        : runChatCompletion(provider, request, {
            fetch: window.fetch.bind(window),
            key,
            signal: window.AbortSignal.any([
              signal,
              window.AbortSignal.timeout(this.store.configuration().timeout),
            ]),
          });
    const messages = [
      { role: 'system', content: '只回答给定的问题，不使用任何工具。' },
      { role: 'user', content: '只回答 CONNECTION_OK，不使用工具。' },
    ];
    const text = await run({ messages, images: [] });
    const canvas = window.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.fillStyle = 'red';
    context.fillRect(0, 0, 96, 96);
    let vision = false;
    try {
      const answer = await run({
        messages: [
          { role: 'system', content: '只根据附带的图片回答，不使用工具。' },
          { role: 'user', content: '图像主体是什么颜色？只回答中文颜色名。' },
        ],
        images: [{ dataURL: canvas.toDataURL('image/png') }],
      });
      vision = /红/u.test(answer);
    } catch (error) {
      if (signal.aborted) throw error;
    }
    return {
      signature: providerSignature(provider),
      text: /CONNECTION_OK/u.test(text),
      vision,
      checkedAt: new Date().toISOString(),
    };
  }

  async close() {
    for (const controller of this.active) controller.abort();
    await this.selectionPool.close();
  }
}
