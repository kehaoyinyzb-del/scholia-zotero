import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadingSession } from '../src/application/reading-session.js';
import { LocalStore } from '../src/runtime/storage.js';
import { captureEvidence } from '../src/domain/evidence.js';
import { view, memoryStore } from './helpers.js';

test('文本提取挂起也受总超时约束，停用可以等待会话收尾', async () => {
  const store = memoryStore();
  store.configuration = () => ({ timeout: 10 });
  const sessions = new ReadingSession({
    reader: {
      capture: () => captureEvidence(view(), 'capture'),
      pages: () => new Promise(() => {}),
    },
    store,
    models: {
      run: () => {
        throw new Error('Model must not be called');
      },
    },
    identifier: () => 'id',
    createAbortController: () => new AbortController(),
  });
  const events = [];
  sessions.subscribe((_identifier, event) => events.push(event));
  await sessions.send({ question: 'why', purpose: 'ask', provider: { context: 32000 } });
  assert.ok(events.some((event) => event.error?.code === 'timeout'));
  await sessions.close();
  assert.equal(sessions.running.size, 0);
  assert.equal(sessions.pending.size, 0);
});

test('侧栏与发送同时加载会话时共用同一个对象，避免丢失新回合', async () => {
  let reads = 0;
  const store = new LocalStore(
    { DataDirectory: { dir: '/isolated' } },
    {
      readJSON: async () => {
        reads += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return { documentId: '1-EXAMPLE', turns: [], glossary: [] };
      },
    },
    { join: (...pieces) => pieces.join('/') },
  );
  const [first, second] = await Promise.all([
    store.session('1-EXAMPLE'),
    store.session('1-EXAMPLE'),
  ]);
  assert.equal(first, second);
  assert.equal(reads, 1);
});
