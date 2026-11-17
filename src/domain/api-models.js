// Official model documentation checked 2026-11-15; see docs/PROVIDERS.md.
// Exact known IDs only: a provider-wide flag must not grant vision to another model.
const visual = new Set([
  'gemini-3.8-flash',
  'gpt-5-mini',
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'kimi-k3.1-pro',
  'kimi-k3',
  'glm-5.3-flash',
  'glm-5.3-flashx',
  'qwen3.7-plus',
  'qwen3.8-max',
  'qwen3.8-flash',
  'qwen3-vl-plus',
  'qwen3-vl-flash',
]);
const reasoning = new Set([
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.3-flashx',
  'kimi-k3.1-pro',
  'kimi-k3',
  'deepseek-flash',
  'deepseek-v4-pro',
]);

export function apiModel(entry) {
  const model = entry.id || entry.model;
  const levels =
    entry.effort?.supported_levels || (reasoning.has(model) ? ['low', 'high', 'max'] : []);
  const modalities =
    entry.input_modalities ||
    entry.inference_metadata?.request_modality?.map((value) => value.toLowerCase());
  return {
    model,
    displayName: entry.name || model,
    description: entry.description || '',
    inputModalities: modalities || (visual.has(model) ? ['text', 'image'] : undefined),
    supportedReasoningEfforts: levels.map((reasoningEffort) => ({ reasoningEffort })),
    defaultReasoningEffort: entry.effort?.default_level || (levels.length ? 'high' : undefined),
  };
}

export function documentedVision(model) {
  return visual.has(model);
}
