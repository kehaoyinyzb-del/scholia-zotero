import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticText, serviceError } from '../src/domain/service-error.js';
import { errorFeedback } from '../src/domain/errors.js';
import { CodexRuntime } from '../src/runtime/codex-runtime.js';

test('区分额度与限流，诊断只复制允许字段和原始状态码', () => {
  const secret = 'sk-private-credential';
  const error = serviceError(429, { code: 'insufficient_quota', message: secret });
  assert.equal(errorFeedback(error).code, 'quota');
  assert.equal(errorFeedback(serviceError(429)).code, 'rate');
  assert.equal(errorFeedback(serviceError(402)).code, 'balance');
  const text = diagnosticText({
    version: 'test',
    zoteroVersion: '10',
    system: 'Darwin',
    provider: { type: 'openai', model: '/Users/private/paper', key: secret },
    error: { ...errorFeedback(error), message: secret, document: 'private manuscript' },
  });
  assert.equal(JSON.parse(text).status, 429);
  assert.doesNotMatch(text, /private|credential|manuscript|Users/u);
});

test('平台与架构选择对应的固定官方发布物', () => {
  for (const [os, abi, expected] of [
    ['Darwin', 'aarch64-gcc3', 'aarch64-apple-darwin.tar.gz'],
    ['WINNT', 'x86_64-msvc', 'x86_64-pc-windows-msvc.exe.zip'],
    ['Linux', 'aarch64-gcc3', 'aarch64-unknown-linux-musl.tar.gz'],
  ]) {
    const runtime = new CodexRuntime({ Services: { appinfo: { OS: os, XPCOMABI: abi } } });
    assert.ok(runtime.platform().asset.name.endsWith(expected));
    assert.match(runtime.platform().asset.sha256, /^[a-f0-9]{64}$/u);
  }
});

test('下载哈希不符时不会解压或执行', async () => {
  let extracted = false;
  const download = { start: async () => {}, cancel: () => {}, finalize: async () => {} };
  const runtime = new CodexRuntime(
    {
      Services: { appinfo: { OS: 'Darwin', XPCOMABI: 'aarch64-gcc3' } },
      PathUtils: {
        join: (...parts) => parts.join('/'),
        parent: (path) => path.slice(0, path.lastIndexOf('/')),
      },
      IOUtils: {
        makeDirectory: async () => {},
        read: async () => new Uint8Array([1]),
        remove: async () => {},
      },
      ChromeUtils: {
        importESModule: (url) => {
          if (url.includes('Downloads'))
            return { Downloads: { createDownload: async () => download } };
          extracted = true;
          throw new Error('Must not execute');
        },
      },
      Components: {
        interfaces: { nsICryptoHash: {} },
        classes: {
          '@mozilla.org/security/hash;1': {
            createInstance: () => ({ init() {}, update() {}, finish: () => 'invalid' }),
          },
        },
      },
    },
    { directory: '/owned' },
  );
  await assert.rejects(
    runtime.download(runtime.platform().asset, () => {}, new AbortController().signal),
    { code: 'download-hash' },
  );
  assert.equal(extracted, false);
});
