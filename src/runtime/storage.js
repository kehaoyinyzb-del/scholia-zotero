import { clone, immutable } from '../domain/immutable.js';
import {
  defaultConfiguration,
  geminiBase,
  validateConfiguration,
} from '../domain/configuration.js';

export class LocalStore {
  constructor(zotero, io, paths) {
    this.zotero = zotero;
    this.io = io;
    this.paths = paths;
    this.directory = paths.join(zotero.DataDirectory.dir, 'reading-companion');
    this.preference = 'extensions.readingCompanion.configuration.v2';
    this.sessions = new Map();
    this.sessionLoads = new Map();
    this.writes = new Map();
    this.glossaryVersions = new Map();
  }

  async initialize() {
    await this.io.makeDirectory(this.directory, { permissions: 0o700, ignoreExisting: true });
  }

  configuration() {
    try {
      const value = JSON.parse(this.zotero.Prefs.get(this.preference, true));
      validateConfiguration(value);
      for (const provider of value.providers) {
        if (provider.type === 'codex' && provider.name === '本机 Codex')
          provider.name = 'Codex（ChatGPT 账号）';
        if (provider.name === 'Google Gemini' && provider.baseURL === geminiBase)
          provider.name = 'Gemini（API Key）';
      }
      return value;
    } catch {
      return clone(defaultConfiguration);
    }
  }

  saveConfiguration(configuration) {
    const validated = validateConfiguration(configuration);
    this.zotero.Prefs.set(this.preference, JSON.stringify(validated), true);
  }

  async read(name, fallback) {
    try {
      return await this.io.readJSON(this.paths.join(this.directory, `${name}.json`));
    } catch (error) {
      if (error.name === 'NotFoundError') return clone(fallback);
      throw new Error('本地会话无法读取。请检查文件权限或备份后修复会话文件。');
    }
  }

  async write(name, value) {
    const path = this.paths.join(this.directory, `${name}.json`);
    const contents = JSON.stringify(value);
    const queued = (this.writes.get(name) || Promise.resolve())
      .catch(() => {})
      .then(() => {
        return this.io.writeUTF8(path, contents, { tmpPath: `${path}.tmp`, permissions: 0o600 });
      });
    this.writes.set(name, queued);
    await queued;
  }

  async session(identifier) {
    if (!/^[\w-]+$/u.test(identifier)) throw new Error('文档标识无效。');
    if (this.sessionLoads.has(identifier)) return this.sessionLoads.get(identifier);
    const loading = this.loadSession(identifier);
    this.sessionLoads.set(identifier, loading);
    try {
      return await loading;
    } finally {
      this.sessionLoads.delete(identifier);
    }
  }

  async loadSession(identifier) {
    if (!this.sessions.has(identifier)) {
      const session = await this.read(`session-${identifier}`, {
        documentId: identifier,
        turns: [],
        glossary: [],
      });
      for (const turn of session.turns) {
        turn.snapshot = immutable(turn.snapshot);
        if (['preparing', 'streaming'].includes(turn.state)) turn.state = 'interrupted';
      }
      this.sessions.set(identifier, session);
      this.glossaryVersions.set(identifier, JSON.stringify(session.glossary));
    }
    return this.sessions.get(identifier);
  }

  saveSession(session) {
    const next = JSON.stringify(session.glossary);
    if (
      this.glossaryVersions.has(session.documentId) &&
      this.glossaryVersions.get(session.documentId) !== next
    ) {
      this.onGlossaryChange?.(session);
    }
    this.glossaryVersions.set(session.documentId, next);
    return this.write(`session-${session.documentId}`, session);
  }

  async close() {
    await Promise.allSettled(this.writes.values());
  }
}
