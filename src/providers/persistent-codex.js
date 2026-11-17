import { selectionInstructions } from '../domain/selection.js';
import { initializeCodex, runCodexTurn, startCodexThread } from './codex.js';
import { providerSignature } from '../domain/configuration.js';
import { ReadingError } from '../domain/errors.js';

// Local comparison: 6-sol passed context/negation checks with the lowest median latency.
export function chooseFastModel(models, requested) {
  const model = requested
    ? models.find((entry) => entry.model === requested)
    : models.find((entry) => entry.model === 'gpt-6-sol') ||
      models.find((entry) => /fast|快速/iu.test(entry.description || '')) ||
      models.find((entry) => entry.isDefault) ||
      models[0];
  if (!model) throw new ReadingError('unconfigured');
  const supported = model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
  const effort = ['none', 'minimal', 'low', 'medium', 'high'].find((value) =>
    supported.includes(value),
  );
  return { model: model.model, effort: effort || model.defaultReasoningEffort };
}

export class PersistentCodex {
  constructor(connect, controller) {
    this.connect = connect;
    this.controller = controller;
    this.generation = 0;
  }

  async ensure(provider) {
    const signature = providerSignature(provider);
    if (this.signature !== signature || this.connection?.client.closed) await this.close();
    if (this.ready) return this.ready;
    this.signature = signature;
    const generation = this.generation;
    const coldStarted = Date.now();
    this.ready = (async () => {
      const connection = await this.connect(provider);
      if (generation !== this.generation) {
        await connection.close();
        throw new ReadingError('cancelled');
      }
      this.connection = connection;
      await initializeCodex(connection.client);
      const catalog = await connection.client.request('model/list', { limit: 100 });
      this.selection = chooseFastModel(catalog.data, provider.model);
      this.info = { ...this.selection, pid: connection.pid, initializedAt: Date.now() };
      const controller = this.controller();
      this.warmController = controller;
      const timer = setTimeout(() => {
        controller.abort();
        connection.close();
      }, 45000);
      try {
        const request = {
          messages: [
            { role: 'system', content: selectionInstructions },
            { role: 'user', content: '{"selected":"Ready","language":"中文","context":""}' },
          ],
          images: [],
        };
        await runCodexTurn(connection.client, request, {
          provider: { ...provider, model: this.selection.model },
          directory: connection.directory,
          signal: controller.signal,
          effort: this.selection.effort,
          release: true,
          onText: () => {
            this.info.coldFirstMs ??= Date.now() - coldStarted;
          },
        });
        this.info.warmedAt = Date.now();
        this.info.coldCompletedMs = Date.now() - coldStarted;
        this.reserve(provider);
      } finally {
        clearTimeout(timer);
      }
      return connection;
    })();
    try {
      return await this.ready;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  reserve(provider) {
    const connection = this.connection;
    const request = { messages: [{ role: 'system', content: selectionInstructions }] };
    this.reserved = startCodexThread(connection.client, request, {
      provider: { ...provider, model: this.selection.model },
      directory: connection.directory,
    });
    this.reserved.catch(() => {});
  }

  async run(provider, request, options) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const connection = await this.ensure(provider);
        if (options.signal.aborted) throw new ReadingError('cancelled');
        const standard = request.messages[0].content === selectionInstructions;
        const started = standard ? this.reserved : undefined;
        if (standard) this.reserve(provider);
        return await runCodexTurn(connection.client, request, {
          ...options,
          provider: { ...provider, model: this.selection.model },
          directory: connection.directory,
          effort: this.selection.effort,
          started: await started,
          release: true,
        });
      } catch (error) {
        if (options.signal.aborted || error.code === 'cancelled') throw error;
        await this.close();
        if (attempt) throw error;
      }
    }
  }

  async close() {
    this.generation++;
    this.warmController?.abort();
    const connection = this.connection;
    this.connection = null;
    this.ready = null;
    this.reserved = null;
    this.signature = null;
    if (connection) await connection.close();
  }
}
