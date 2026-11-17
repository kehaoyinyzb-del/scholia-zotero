import { ReadingError } from '../domain/errors.js';
import { serviceError } from '../domain/service-error.js';

/** Transport owns pipes and process lifetime. This class owns framing and pending requests only. */
export class JsonRpcClient {
  constructor(write, timeout = 15000) {
    this.write = write;
    this.timeout = timeout;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = '';
    this.closed = false;
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new ReadingError('connection'));
    const identifier = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(identifier);
        reject(new ReadingError('timeout'));
      }, this.timeout);
      this.pending.set(identifier, { resolve, reject, timer });
      Promise.resolve(this.write(JSON.stringify({ id: identifier, method, params }) + '\n')).catch(
        () => this.close(new ReadingError('connection')),
      );
    });
  }

  notify(method, params = {}) {
    return this.write(JSON.stringify({ method, params }) + '\n');
  }

  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.close(new ReadingError('protocol'));
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.close(new ReadingError('protocol'));
        return;
      }
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (message.method && message.id !== undefined) {
      // This reader never authorizes filesystem, shell, external tools or authentication refresh.
      const response = {
        id: message.id,
        error: { code: -32601, message: 'This client does not support tool or approval requests' },
      };
      Promise.resolve(this.write(JSON.stringify(response) + '\n')).catch(() => {});
      return;
    }
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = serviceError(undefined, message.error, 'codex');
        if (error.code === 'service') error.code = 'protocol';
        error.details.rpcCode = message.error.code;
        waiting.reject(error);
      } else waiting.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const listener of this.listeners) listener(message.method, message.params || {});
    }
  }

  close(error = new ReadingError('connection')) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners) listener('client/closed', { error });
    this.listeners.clear();
  }
}
