import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  surroundingSentences,
  selectionRequest,
  cleanSelectionText,
  selectionPresentation,
} from '../src/domain/selection.js';
import { chooseFastModel } from '../src/providers/persistent-codex.js';

test('词典短行流式拆字段，标签不闪入主释义，句子保持原样', () => {
  assert.equal(selectionPresentation('释义：', true).meaning, '');
  assert.deepEqual(
    selectionPresentation('释义：权利\n词性：名词\n其他：右侧\n语境：与 privacy 连用', true),
    {
      meaning: '权利',
      partOfSpeech: '名词',
      alternatives: '右侧',
      context: '与 privacy 连用',
    },
  );
  assert.equal(selectionPresentation('误差线；名词；胡须', true).meaning, '误差线');
  assert.equal(selectionPresentation('不得改变 DATA。').meaning, '不得改变 DATA。');
});

test('划词上下文定位邻近出现位置，保留前后句而不发送整页', () => {
  const text =
    'An assert is a claim. This is a circuit. We assert VALID here. DATA stays stable. End.';
  const context = surroundingSentences(text, 'assert', text.indexOf('assert VALID'));
  assert.match(context, /This is a circuit\. We assert VALID here\. DATA stays stable\./u);
  assert.doesNotMatch(context, /An assert|End\./u);
});

test('轻量划词请求无图像，仅传命中术语，词与句模式不同', () => {
  const request = selectionRequest({
    selected: 'assert',
    context: 'assert VALID',
    glossary: [
      { source: 'assert', translation: '置为有效' },
      { source: 'unrelated', translation: '无关' },
    ],
  });
  assert.equal(request.images.length, 0);
  const input = JSON.parse(request.messages[1].content);
  assert.equal(input.glossary.length, 1);
  assert.match(input.style, /词典/u);
  assert.equal(
    JSON.parse(
      selectionRequest({ selected: 'Do not change 3 bits.', context: '' }).messages[1].content,
    ).style,
    '仅译文',
  );
  assert.equal(cleanSelectionText('<think>hidden</think>译文：不得改变 3 位。'), '不得改变 3 位。');
});

test('快速模型与强度来自实际目录，显式模型不被替换', () => {
  const catalog = [
    {
      model: 'default',
      isDefault: true,
      description: 'balanced',
      supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
    },
    {
      model: 'quick',
      description: 'Fast model',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
    },
  ];
  assert.deepEqual(chooseFastModel(catalog), { model: 'quick', effort: 'low' });
  assert.deepEqual(chooseFastModel(catalog, 'default'), { model: 'default', effort: 'high' });
  assert.throws(() => chooseFastModel(catalog, 'missing'));
});

import { PersistentCodex } from '../src/providers/persistent-codex.js';

test('常驻进程复用连接，每轮用独立临时线程且退出释放连接', async () => {
  let connections = 0;
  let closed = 0;
  const threads = [];
  const turns = [];
  const released = [];
  const listeners = new Set();
  const client = {
    closed: false,
    notify: async () => {},
    onNotification: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    request: async (method, params) => {
      if (method === 'model/list')
        return {
          data: [
            {
              model: 'fast',
              description: 'Fast',
              supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
            },
          ],
        };
      if (method === 'thread/start') {
        assert.equal(params.ephemeral, true);
        assert.equal(params.config['features.shell_tool'], false);
        const id = String(threads.length);
        threads.push(id);
        return { thread: { id } };
      }
      if (method === 'turn/start') {
        turns.push(params.threadId);
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener('item/agentMessage/delta', { threadId: params.threadId, delta: '译文' });
            listener('turn/completed', {
              threadId: params.threadId,
              turn: { id: 't', status: 'completed' },
            });
          }
        });
        return { turn: { id: 't' } };
      }
      if (method === 'thread/unsubscribe') released.push(params.threadId);
      return {};
    },
  };
  const pool = new PersistentCodex(
    async () => {
      connections++;
      return {
        client,
        pid: 1,
        directory: '/isolated',
        close: async () => {
          closed++;
        },
      };
    },
    () => new AbortController(),
  );
  const provider = { type: 'codex', model: '', path: '' };
  await Promise.all([pool.ensure(provider), pool.ensure(provider)]);
  for (let i = 0; i < 20; i++) {
    const result = await pool.run(provider, selectionRequest({ selected: 'word', context: '' }), {
      signal: new AbortController().signal,
    });
    assert.equal(result, '译文');
  }
  assert.equal(connections, 1);
  assert.equal(new Set(turns).size, 21);
  assert.equal(released.length, 21);
  await pool.close();
  assert.equal(closed, 1);
});

test('常驻连接启动失败只重试一次', async () => {
  let attempts = 0;
  const pool = new PersistentCodex(
    async () => {
      attempts++;
      throw new Error('unavailable');
    },
    () => new AbortController(),
  );
  await assert.rejects(
    pool.run({ type: 'codex' }, selectionRequest({ selected: 'x', context: '' }), {
      signal: new AbortController().signal,
    }),
  );
  assert.equal(attempts, 2);
});

import { SelectionPopup } from '../src/runtime/selection-popup.js';

test('阅读器 iframe 已销毁仍可清理监听和样式，未打开 PDF 不启动轮询', () => {
  const failures = [];
  const popup = new SelectionPopup({ recordFailure: (error) => failures.push(error) });
  assert.equal(popup.timer, undefined);
  const dead = () => {
    throw new TypeError("can't access dead object");
  };
  popup.frames.set({}, { unwrapped: { removeEventListener: dead }, release: () => {} });
  popup.styles.set({}, { remove: dead });
  popup.active = {
    controller: { abort: dead },
    observer: { disconnect: dead },
    root: { remove: dead },
    record: { state: 'waiting' },
  };
  popup.close();
  assert.equal(popup.frames.size + popup.styles.size, 0);
  assert.equal(popup.active, null);
  assert.equal(failures.length, 0);
});
