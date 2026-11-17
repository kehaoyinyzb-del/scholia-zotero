import { documentedVision } from './api-models.js';
export const geminiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';

export const defaultConfiguration = {
  providers: [
    {
      id: 'codex',
      name: 'Codex（ChatGPT 账号）',
      type: 'codex',
      model: '',
      path: '',
      context: 64000,
      vision: false,
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      context: 1000000,
      vision: false,
    },
  ],
  routes: { ask: 'codex', translate: 'codex', vision: 'codex', selection: 'codex' },
  translation: { language: '中文', trigger: 'auto', annotationComment: true },
  timeout: 120000,
  libraryID: null,
  collectionID: null,
};

const providerFields = new Set([
  'id',
  'name',
  'type',
  'model',
  'path',
  'baseURL',
  'legacyKeyOrigin',
  'context',
  'vision',
  'probe',
]);

export function providerSignature(provider) {
  return JSON.stringify([
    provider.type,
    provider.model,
    provider.baseURL || '',
    provider.path || '',
  ]);
}

// Existing profiles stored keys by provider ID. Keep that key tied to its original host
// when the user edits a connection, with separate login records for subsequent origins.
export function apiKeyId(provider) {
  const origin = new URL(provider.baseURL).origin;
  return provider.legacyKeyOrigin && provider.legacyKeyOrigin !== origin
    ? provider.id + '@' + origin
    : provider.id;
}

export function catalogKey(provider) {
  const signature = providerSignature(provider);
  return provider.type === 'codex' ? signature : provider.id + ':' + signature;
}

export function validateConfiguration(configuration) {
  const topFields = ['providers', 'routes', 'timeout', 'libraryID', 'collectionID', 'translation'];
  if (Object.keys(configuration).some((key) => !topFields.includes(key))) {
    throw new Error('配置含未支持字段。密钥请通过密钥输入框保存。');
  }
  if (!Array.isArray(configuration.providers)) {
    throw new Error('请配置至少一个模型后端。');
  }
  const identifiers = new Set();
  for (const provider of configuration.providers) {
    if (Object.keys(provider).some((key) => !providerFields.has(key))) {
      throw new Error('模型配置含未支持字段。密钥请通过密钥输入框保存。');
    }
    if (!/^[\w-]{1,64}$/u.test(provider.id) || identifiers.has(provider.id)) {
      throw new Error('服务商标识应唯一，仅使用字母、数字、下划线和短横线。');
    }
    identifiers.add(provider.id);
    if (!['codex', 'deepseek', 'openai', 'google-oauth'].includes(provider.type)) {
      throw new Error('请选择 Codex、DeepSeek 或 OpenAI 兼容协议。');
    }
    if (provider.type === 'google-oauth' && provider.baseURL !== geminiBase)
      throw new Error('Google 账号连接须使用官方 Gemini 接口。');
    if (provider.type !== 'codex') {
      const url = new URL(provider.baseURL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('API 地址须为 HTTPS，且不含凭据或查询参数。');
      }
      if (!provider.model?.trim()) throw new Error('请填写模型 ID。');
    }
    if (!Number.isInteger(provider.context) || provider.context < 4096) {
      throw new Error('请填写不少于 4096 的上下文长度。');
    }
    if (provider.probe) {
      const probe = provider.probe;
      if (
        Object.keys(probe).some(
          (key) => !['signature', 'text', 'vision', 'checkedAt'].includes(key),
        )
      ) {
        throw new Error('能力测试记录格式错误。');
      }
      if (typeof probe.text !== 'boolean' || typeof probe.vision !== 'boolean') {
        throw new Error('能力测试结果须为布尔值。');
      }
    }
  }
  for (const purpose of ['ask', 'translate', 'vision']) {
    if (!identifiers.size && configuration.routes?.[purpose] === '') continue;
    if (!identifiers.has(configuration.routes?.[purpose]))
      throw new Error('请为每项用途选择模型。');
  }
  if (
    configuration.translation &&
    (!['auto', 'click', 'off'].includes(configuration.translation.trigger) ||
      typeof configuration.translation.language !== 'string' ||
      typeof configuration.translation.annotationComment !== 'boolean')
  ) {
    throw new Error('请检查翻译设置。');
  }
  if (configuration.routes.selection && !identifiers.has(configuration.routes.selection)) {
    throw new Error('请为划词翻译选择模型。');
  }
  return configuration;
}

export function modelCapabilities(provider) {
  const probeMatches = provider.probe?.signature === providerSignature(provider);
  return {
    text: probeMatches ? provider.probe.text : null,
    vision: provider.inputModalities
      ? provider.inputModalities.includes('image')
      : probeMatches
        ? provider.probe.vision
        : provider.type !== 'codex' && documentedVision(provider.model),
    context: provider.context,
    verified: probeMatches,
  };
}
