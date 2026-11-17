import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { apiPresets } from '../src/runtime/setup.js';
import { readAPICatalog } from '../src/providers/catalog.js';
import { runChatCompletion } from '../src/providers/chat.js';
import { errorFeedback } from '../src/domain/errors.js';
import { modelCapabilities } from '../src/domain/configuration.js';
import { nativeNoteRichText } from '../src/runtime/notebook.js';
import { renderRichText } from '../src/ui/rich-text.js';
import { effortTiers } from '../src/ui/model-menu.js';
import { ModelService } from '../src/runtime/models.js';
import { originalSelection } from '../src/domain/selected-text.js';

test('服务商响应形态：目录、思考流隔离、密钥/欠费/限流', async () => {
  let body,
    status = 200,
    stream = false;
  const received = [];
  const server = createServer(async (request, response) => {
    let input = '';
    for await (const chunk of request) input += chunk;
    received.push({ path: request.url, body: input ? JSON.parse(input) : null });
    response.writeHead(status, {
      'Content-Type': stream ? 'text/event-stream' : 'application/json',
    });
    if (!stream) return response.end(JSON.stringify(body));
    response.write(
      ': heartbeat\n\ndata: ' +
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_THOUGHT' } }] }) +
        '\n\n',
    );
    response.write(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: '只保留最终回答：2.50 V' } }] }) +
        '\n\n',
    );
    response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localFetch = (url, options) =>
    fetch(
      `http://127.0.0.1:${server.address().port}${new URL(url).pathname}${new URL(url).search}`,
      options,
    );
  const signal = new AbortController().signal;
  const errors = {
    gemini: [
      [400, { status: 'INVALID_ARGUMENT', message: 'API key not valid.' }],
      [402, {}],
      [429, { status: 'RESOURCE_EXHAUSTED' }],
    ],
    openai: [
      [401, { code: 'invalid_api_key' }],
      [402, {}],
      [429, { code: 'rate_limit_exceeded' }],
    ],
    glm: [
      [401, { code: '1000' }],
      [429, { code: '1113' }],
      [429, { code: '1302' }],
    ],
    deepseek: [
      [401, { type: 'authentication_error' }],
      [402, { type: 'insufficient_balance' }],
      [429, { type: 'rate_limit_error' }],
    ],
    qwen: [
      [401, { code: 'InvalidApiKey' }],
      [403, { code: 'Arrearage' }],
      [429, { code: 'Throttling.RateQuota' }],
    ],
    kimi: [
      [401, { type: 'invalid_authentication_error' }],
      [429, { type: 'exceeded_current_quota_error', message: 'Insufficient Balance' }],
      [429, { type: 'rate_limit_reached_error' }],
    ],
  };
  try {
    for (const provider of apiPresets) {
      status = 200;
      stream = false;
      const model = {
        id: provider.model,
        description: 'Original English description',
        input_modalities: ['text'],
      };
      body =
        provider.id === 'qwen'
          ? {
              success: true,
              output: {
                total: 1,
                models: [
                  {
                    model: provider.model,
                    description: model.description,
                    inference_metadata: { request_modality: ['Text', 'Image'] },
                  },
                ],
              },
            }
          : { object: 'list', data: [model] };
      const catalog = await readAPICatalog(provider, {
        fetch: localFetch,
        key: 'test-only',
        signal,
      });
      assert.equal(catalog[0].description, model.description);
      assert.equal(catalog[0].model, provider.model);
      stream = true;
      const deltas = [];
      const text = await runChatCompletion(
        provider.id === 'openai' ? provider : { ...provider, effort: 'low' },
        { messages: [{ role: 'user', content: 'fixture' }], images: [] },
        { fetch: localFetch, key: 'test-only', signal, onText: (text) => deltas.push(text) },
      );
      assert.equal(text, '只保留最终回答：2.50 V');
      assert.ok(deltas.length);
      assert.equal(
        received.at(-1).body.reasoning_effort,
        provider.id === 'openai' ? undefined : 'low',
      );
      stream = false;
      for (const [index, fixture] of errors[provider.id].entries()) {
        [status, body] = [fixture[0], { error: fixture[1] }];
        await assert.rejects(
          runChatCompletion(
            provider,
            { messages: [], images: [] },
            { fetch: localFetch, key: 'test-only', signal },
          ),
          (error) => errorFeedback(error).code === ['key', 'balance', 'rate'][index],
        );
      }
    }
    status = 404;
    stream = false;
    body = { error: { code: 'not_found' } };
    const service = new ModelService(
      {
        Zotero: {
          getMainWindow: () => ({
            fetch: localFetch,
            AbortSignal,
            AbortController,
          }),
        },
      },
      {},
      { get: async () => 'test-only' },
      '',
    );
    const fallback = await service.catalog(apiPresets[0]);
    assert.equal(fallback.models[0].model, 'glm-5.3');
    assert.equal(fallback.disabled, undefined);
    const tiers = effortTiers({
      defaultReasoningEffort: 'low',
      supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({
        reasoningEffort,
      })),
    });
    assert.deepEqual(
      tiers.map((entry) => entry.label),
      ['快', '标准', '深入'],
    );

    assert.ok(fallback.reason);
    assert.equal(modelCapabilities({ type: 'openai', model: 'glm-5.3' }).vision, false);
    assert.equal(modelCapabilities({ type: 'openai', model: 'glm-5.3-flash' }).vision, true);
    assert.equal(
      modelCapabilities({ type: 'openai', model: 'unknown', vision: true }).vision,
      false,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('笔记与选中文字保存原文：范围、单位、否定、信号、URL及公式', () => {
  const document = new JSDOM('').window.document;
  const original = '不能把2.50V改成3~5V；DATA[7:0]和RESET_N保持不变。https://example.org/2~3mg';
  const displayed = renderRichText(document, original).textContent;
  assert.equal(displayed.replace(/\s/gu, ''), original.replace(/\s/gu, ''));
  assert.equal(nativeNoteRichText(document, original).textContent, original);
  assert.equal(originalSelection(original, '2.50\u00a0V'), '2.50V');
  const formula = nativeNoteRichText(document, '$x_1=2$');
  assert.equal(formula.querySelector('.math').textContent, '$x_1=2$');
});
