import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadingSession } from '../src/application/reading-session.js';
import { captureEvidence } from '../src/domain/evidence.js';
import { providerSignature } from '../src/domain/configuration.js';
import { view, specification, memoryStore } from './helpers.js';

test('正常发送入口固定图像与检索出处，翻页后追问仍发送旧图，换文献隔离', async () => {
  let currentView = view();
  let resolveModel;
  const received = [];
  const store = memoryStore();
  const provider = { id: 'local', name: 'Local', type: 'codex', model: '', context: 64000 };
  provider.probe = { signature: providerSignature(provider), text: true, vision: true };
  const sessions = new ReadingSession({
    reader: {
      capture: () => captureEvidence(currentView, 'captured'),
      pages: async () => specification,
    },
    store,
    models: {
      run: async (_provider, request) => {
        received.push(request);
        return new Promise((resolve) => {
          resolveModel = resolve;
        });
      },
    },
    identifier: () => 'identifier-' + received.length,
    createAbortController: () => new AbortController(),
  });
  const send = (question) =>
    sessions.send({ activeReader: {}, question, purpose: 'ask', provider });
  const first = send('第三拍为什么不能换数据？');
  currentView.pageIndex = 3;
  currentView.images[0].pageIndex = 3;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received[0].images[0].pageIndex, 1);
  const evidence = JSON.parse(received[0].messages[1].content).evidence;
  assert.ok(evidence.sources.some((source) => source.pageIndex === 0));
  resolveModel('{"answer":"first"}');
  const turn = await first;
  assert.ok(Object.isFrozen(turn.snapshot.sources));
  const second = send('为什么？');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received[1].images[0].pageIndex, 1);
  resolveModel('{"answer":"second"}');
  await second;
  const third = send('那现在这张图呢？');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received[2].images[0].pageIndex, 3);
  resolveModel('{"answer":"third"}');
  await third;
  currentView = view('2-OTHER', 0);
  const fourth = send('为什么？');
  await new Promise((resolve) => setImmediate(resolve));
  const sent = JSON.parse(received[3].messages[1].content);
  assert.deepEqual(sent.discussion, []);
  assert.equal(sent.evidence.document.id, '2-OTHER');
  resolveModel('{"answer":"fourth"}');
  await fourth;
});

test('提取期间取消不调用服务商，未配置模型有明确状态', async () => {
  const store = memoryStore();
  let releasePages;
  let called = false;
  const sessions = new ReadingSession({
    reader: {
      capture: () => captureEvidence(view(), 'capture'),
      pages: async () =>
        new Promise((resolve) => {
          releasePages = resolve;
        }),
    },
    store,
    models: {
      run: async () => {
        called = true;
      },
    },
    identifier: () => 'id',
    createAbortController: () => new AbortController(),
  });
  const states = [];
  sessions.subscribe((_identifier, state) => states.push(state));
  const pending = sessions.send({ question: 'why', purpose: 'ask', provider: { context: 32000 } });
  await new Promise((resolve) => setImmediate(resolve));
  sessions.cancel('1-EXAMPLE');
  releasePages(specification);
  await pending;
  assert.equal(called, false);
  await sessions.send({ question: 'why', purpose: 'ask' });
  assert.ok(states.some((state) => state.error?.code === 'unconfigured'));
});

test('有页面图像但无文本层时，文字翻译准确报错且不发模型请求', async () => {
  let called = false;
  const states = [];
  const sessions = new ReadingSession({
    reader: {
      capture: () => captureEvidence(view(), 'capture'),
      pages: async () => [{ pageIndex: 1, text: '', paragraphs: [] }],
    },
    store: memoryStore(),
    models: {
      run: async () => {
        called = true;
      },
    },
    identifier: () => 'id',
    createAbortController: () => new AbortController(),
  });
  sessions.subscribe((_id, state) => states.push(state));
  await sessions.send({
    question: '翻译本页',
    purpose: 'translate-page',
    provider: { context: 32000 },
  });
  assert.equal(called, false);
  assert.ok(states.some((state) => state.error?.code === 'no-text-translation'));
});

test('引用跨页原文进入请求，移除后不偷带 PDF 残留选区，去掉页条不发送页面', async () => {
  const store = memoryStore();
  const current = view();
  current.selection = { text: 'old selection', pageIndexes: [0], positions: [] };
  const requests = [];
  const sessions = new ReadingSession({
    reader: {
      capture: () => captureEvidence(current, 'c'),
      current: () => current,
      pages: async () => specification,
    },
    store,
    models: {
      run: async (_provider, request) => {
        requests.push(JSON.parse(request.messages[1].content));
        return '{"answer":"回答"}';
      },
    },
    identifier: () => `turn-${requests.length}`,
    createAbortController: () => new AbortController(),
  });
  const references = [0, 2].map((pageIndex) => ({
    text: specification[pageIndex].text,
    pageIndex,
    position: specification[pageIndex].paragraphs[0].position,
  }));
  const options = {
    question: '讲懂这两句',
    purpose: 'ask',
    mode: 'current',
    provider: { id: 'codex', name: 'Codex', type: 'codex', model: '', context: 64000 },
    ignoreSelection: true,
    references,
  };
  const first = await sessions.send(options);
  assert.deepEqual(first.sentEvidence.references, references);
  assert.equal(first.sentEvidence.sources[0].id, 'quote-1');
  assert.equal(first.sentEvidence.sources[1].pageIndex, 2);
  await sessions.send({ ...options, references: [], includePage: false });
  assert.deepEqual(requests[1].evidence.sources, []);
  assert.deepEqual(requests[1].evidence.images, []);
  assert.deepEqual(requests[1].evidence.references, []);
  assert.equal(requests[1].evidence.selection, null);
});
