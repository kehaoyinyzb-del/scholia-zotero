import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonRpcClient } from '../src/providers/json-rpc.js';
import { runCodexTurn } from '../src/providers/codex.js';
import { readChatStream } from '../src/providers/event-stream.js';

test('JSON-RPC 分块、多行和乱序响应按 id 匹配', async () => {
  const outgoing = [];
  const client = new JsonRpcClient((line) => outgoing.push(JSON.parse(line)), 100);
  const first = client.request('first', {});
  const second = client.request('second', {});
  client.receive('{"id":2,"result":"second"}\n{"id":');
  client.receive('1,"result":"first"}\n');
  assert.equal(await second, 'second');
  assert.equal(await first, 'first');
  assert.equal(outgoing.length, 2);
  client.close();
});

test('JSON-RPC 超时、进程退出和服务端工具请求不会挂起', async () => {
  const outgoing = [];
  const client = new JsonRpcClient((line) => outgoing.push(JSON.parse(line)), 5);
  await assert.rejects(client.request('slow', {}), /timeout/u);
  client.receive('{"id":99,"method":"item/commandExecution/requestApproval"}\n');
  assert.equal(outgoing.at(-1).error.code, -32601);
  const pending = client.request('pending', {});
  client.close();
  await assert.rejects(pending, /connection/u);
  assert.equal(client.pending.size, 0);
});

test('Codex turn 只转发 agentMessage，取消发出 turn/interrupt 并丢弃完成结果', async () => {
  let notify;
  const requests = [];
  const controller = new AbortController();
  const client = {
    onNotification(callback) {
      notify = callback;
      return () => {};
    },
    async request(method, parameters) {
      requests.push({ method, parameters });
      if (method === 'thread/start') return { thread: { id: 'thread' } };
      if (method === 'turn/start') return { turn: { id: 'turn' } };
      if (method === 'turn/interrupt') {
        notify('turn/completed', { threadId: 'thread', turn: { status: 'interrupted' } });
      }
      return {};
    },
  };
  const deltas = [];
  const result = runCodexTurn(
    client,
    {
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'evidence' },
      ],
      images: [],
    },
    {
      provider: { model: '' },
      directory: '/tmp',
      signal: controller.signal,
      onText: (text) => deltas.push(text),
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  notify('item/reasoning/textDelta', { threadId: 'thread', delta: 'hidden' });
  notify('item/started', {
    threadId: 'thread',
    item: { type: 'agentMessage', id: 'c', phase: 'commentary' },
  });
  notify('item/agentMessage/delta', {
    threadId: 'thread',
    itemId: 'c',
    delta: 'progress narration',
  });
  notify('item/agentMessage/delta', { threadId: 'thread', delta: 'visible' });
  controller.abort();
  await assert.rejects(result, /cancelled/u);
  assert.deepEqual(deltas, ['visible']);
  assert.ok(requests.some((request) => request.method === 'turn/interrupt'));
  assert.equal(requests[0].parameters.ephemeral, true);
});

test('SSE 跨 UTF-8 字节、事件边界保留文字并排除 reasoning_content', async () => {
  const text = [
    'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"中文"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  ].join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (const value of bytes) controller.enqueue(Uint8Array.of(value));
      controller.close();
    },
  });
  assert.equal(await readChatStream(stream), '中文');
});

test('SSE 提前 EOF 和上下文截断不能标为完成', async () => {
  for (const text of [
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
  ]) {
    const body = new Response(text).body;
    await assert.rejects(readChatStream(body));
  }
});
