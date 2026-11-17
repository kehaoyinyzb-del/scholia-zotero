import { initializeCodex } from '../providers/codex.js';
import { apiKeyId, geminiBase } from '../domain/configuration.js';
import { ReadingError } from '../domain/errors.js';

export const apiPresets = [
  {
    id: 'glm',
    name: '智谱 GLM',
    type: 'openai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    context: 1000000,
    vision: false,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    context: 1000000,
    vision: true,
  },
  {
    id: 'qwen',
    name: '通义千问',
    type: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
    context: 1000000,
    vision: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    type: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro',
    context: 1000000,
    vision: true,
  },
  {
    id: 'gemini',
    name: 'Gemini（API Key）',
    type: 'openai',
    baseURL: geminiBase,
    model: 'gemini-3.8-flash',
    context: 1048576,
    vision: true,
  },
  {
    id: 'openai',
    name: 'OpenAI（GPT API）',
    type: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    context: 400000,
    vision: true,
  },
];

export const googleAccount = {
  ...apiPresets.find((preset) => preset.id === 'gemini'),
  id: 'gemini-account',
  name: 'Gemini（Google 账号）',
  type: 'google-oauth',
};

export class ConnectionSetup {
  constructor(application) {
    this.application = application;
    this.controllers = new Set();
    this.pending = new Set();
  }

  provider() {
    const providers = this.application.store.configuration().providers;
    return (
      providers.find((entry) => entry.type === 'codex') || {
        id: providers.some((entry) => entry.id === 'codex')
          ? 'custom-' + this.application.identifier()
          : 'codex',
        name: 'Codex（ChatGPT 账号）',
        type: 'codex',
        model: '',
        path: '',
        context: 64000,
        vision: false,
      }
    );
  }

  googleProvider() {
    const providers = this.application.store.configuration().providers;
    return (
      providers.find((entry) => entry.type === 'google-oauth') || {
        ...googleAccount,
        id: providers.some((entry) => entry.id === googleAccount.id)
          ? 'custom-' + this.application.identifier()
          : googleAccount.id,
      }
    );
  }

  save(provider, select = true) {
    const app = this.application;
    const configuration = app.store.configuration();
    const index = configuration.providers.findIndex((entry) => entry.id === provider.id);
    if (index < 0) configuration.providers.push(provider);
    else configuration.providers[index] = provider;
    if (select || !configuration.routes.ask)
      for (const purpose of Object.keys(configuration.routes))
        configuration.routes[purpose] = provider.id;
    app.store.saveConfiguration(configuration);
    app.models.catalogs?.clear();
    if (select)
      app.environment.Zotero.Prefs.clear('extensions.readingCompanion.chatModel.v1', true);
  }

  async available() {
    const app = this.application;
    const configuration = app.store.configuration();
    const provider = configuration.providers.find((entry) => entry.id === configuration.routes.ask);
    if (!provider) throw new ReadingError('unconfigured');
    if (provider.type === 'google-oauth') {
      if (!(await app.models.google.connected(provider.id))) throw new ReadingError('google-auth');
      return provider;
    }
    if (provider.type !== 'codex') {
      if (!(await app.secrets.get(apiKeyId(provider)))) throw new ReadingError('key');
      return provider;
    }
    const connection = await app.models.connectCodex(provider);
    try {
      await initializeCodex(connection.client);
      const account = await connection.client.request('account/read', { refreshToken: false });
      if (account.requiresOpenaiAuth && !account.account) throw new ReadingError('login');
      await connection.client.request('model/list', { limit: 1 });
      return provider;
    } catch (error) {
      if ([-32601, -32602].includes(error.details?.rpcCode)) throw new ReadingError('codex-old');
      throw error;
    } finally {
      await connection.close();
    }
  }

  async login(window, { signal, onProgress, onLoginURL, select = true }) {
    const app = this.application;
    const provider = this.provider();
    try {
      await app.models.executable(provider);
    } catch (error) {
      if (error.code !== 'executable') throw error;
      provider.path = await app.models.runtime.install(window, onProgress, signal);
      this.save(provider, false);
    }
    const connection = await app.models.connectCodex(provider);
    let loginId, unsubscribe, timer;
    const abort = () => {
      if (loginId) connection.client.request('account/login/cancel', { loginId }).catch(() => {});
      connection.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      await initializeCodex(connection.client);
      const completed = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new ReadingError('login-timeout')), 10 * 60 * 1000);
        unsubscribe = connection.client.onNotification((method, parameters) => {
          if (method === 'client/closed')
            reject(new ReadingError(signal.aborted ? 'cancelled' : 'connection'));
          if (
            method === 'account/login/completed' &&
            (!loginId || parameters.loginId === loginId)
          ) {
            if (parameters.success) resolve();
            else reject(new ReadingError('login'));
          }
        });
      });
      completed.catch(() => {});
      const started = await connection.client.request('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: true,
      });
      loginId = started.loginId;
      const url = new URL(started.authUrl);
      if (
        url.protocol !== 'https:' ||
        !(url.hostname === 'openai.com' || url.hostname.endsWith('.openai.com'))
      )
        throw new ReadingError('protocol');
      onProgress('已在浏览器中打开登录页，完成后会自动回到这里');
      onLoginURL?.(started.authUrl);
      app.environment.Zotero.launchURL(started.authUrl);
      await completed;
      const account = await connection.client.request('account/read', { refreshToken: false });
      if (!account.account) throw new ReadingError('login');
      this.save(provider, select);
      await app.models.selectionPool.close();
      window.focus();
      return provider;
    } catch (error) {
      if ([-32601, -32602].includes(error.details?.rpcCode)) throw new ReadingError('codex-old');
      throw error;
    } finally {
      clearTimeout(timer);
      unsubscribe?.();
      signal.removeEventListener('abort', abort);
      if (loginId)
        await connection.client.request('account/login/cancel', { loginId }).catch(() => {});
      await connection.close();
    }
  }

  async selectFile(window) {
    const { ChromeUtils } = this.application.environment;
    const { FilePicker } = ChromeUtils.importESModule(
      'chrome://zotero/content/modules/filePicker.mjs',
    );
    const picker = new FilePicker();
    picker.init(window, '选择 Codex 可执行文件', picker.modeOpen);
    picker.appendFilters(picker.filterAll);
    if ((await picker.show()) !== picker.returnOK) return false;
    const provider = this.provider();
    provider.path = picker.file;
    this.save(provider, false);
    return true;
  }

  async testAPI(provider, key, signal) {
    const app = this.application;
    const probe = await app.models.probe(provider, signal, key);
    if (!probe.text) throw new ReadingError('protocol');
    signal.throwIfAborted();
    const previous = app.store.configuration().providers.find((entry) => entry.id === provider.id);
    if (previous?.legacyKeyOrigin || previous?.baseURL)
      provider = {
        ...provider,
        legacyKeyOrigin: previous.legacyKeyOrigin || new URL(previous.baseURL).origin,
      };
    await app.secrets.set(apiKeyId(provider), key);
    signal.throwIfAborted();
    this.save({ ...provider, probe });
    return { ...provider, probe };
  }

  async close() {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    await Promise.allSettled(this.pending);
  }
}
