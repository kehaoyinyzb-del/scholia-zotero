import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultConfiguration,
  validateConfiguration,
  modelCapabilities,
  providerSignature,
} from '../src/domain/configuration.js';
import { errorFeedback } from '../src/domain/errors.js';
import { SecretStore } from '../src/runtime/secrets.js';

test('密钥字段被配置边界拒绝，模型能力测试随 endpoint/model 变化失效', () => {
  const configuration = structuredClone(defaultConfiguration);
  configuration.providers[0].apiKey = 'forbidden';
  assert.throws(() => validateConfiguration(configuration), /密钥/u);
  const provider = { ...defaultConfiguration.providers[1] };
  provider.probe = { signature: providerSignature(provider), text: true, vision: true };
  assert.equal(modelCapabilities(provider).vision, true);
  provider.model = 'another-model';
  assert.equal(modelCapabilities(provider).vision, false);
});

test('拒绝 HTTP、内嵌凭据与查询串 API 地址', () => {
  for (const address of [
    'http://example.org',
    'https://secret@example.org',
    'https://e.org?key=x',
  ]) {
    const configuration = structuredClone(defaultConfiguration);
    configuration.providers[1].baseURL = address;
    assert.throws(() => validateConfiguration(configuration));
  }
});

test('错误反馈分类且不输出服务商原文', () => {
  for (const [status, code] of [
    [401, 'key'],
    [402, 'balance'],
    [404, 'model'],
    [429, 'rate'],
  ]) {
    const feedback = errorFeedback({ status, message: 'secret input' }, 'deepseek');
    assert.equal(feedback.code, code);
    assert.doesNotMatch(JSON.stringify(feedback), /secret/u);
    assert.ok(feedback.title && feedback.reason && feedback.action);
  }
  assert.equal(errorFeedback({ status: 401 }, 'codex').code, 'login');
  assert.equal(errorFeedback({ name: 'AbortError' }).code, 'cancelled');
});

test('密钥只经登录管理器，更新失败不会先删除原密钥', async () => {
  const existing = { password: 'old' };
  let removed = false;
  const secrets = new SecretStore(
    {
      logins: {
        findLogins: () => [existing],
        modifyLogin: () => {
          throw new Error('write failed');
        },
        removeLogin: () => {
          removed = true;
        },
      },
    },
    {
      classes: {
        '@mozilla.org/login-manager/loginInfo;1': { createInstance: () => ({ init() {} }) },
      },
      interfaces: { nsILoginInfo: {} },
    },
  );
  await assert.rejects(() => secrets.set('api', 'new'));
  assert.equal(removed, false);
  assert.equal(await secrets.get('api'), 'old');
});
