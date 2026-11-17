import { ReadingError } from './errors.js';

export function serviceError(status, details = {}, providerType = 'openai', retryAfter) {
  const text = [details.code, details.type, details.status, details.message].join(' ');
  let code = 'service';
  if (
    status === 401 ||
    /api.key.not.valid|api.key.invalid|unauthorized|authentication|login|\b401\b/iu.test(text)
  )
    code = providerType === 'codex' ? 'login' : 'key';
  else if (
    status === 402 ||
    /insufficient.balance|balance.not.enough|arrearage|余额不足|欠费|\b1113\b/iu.test(text)
  )
    code = 'balance';
  else if (
    /usage.?limit.?exceeded|insufficient.quota|quota.?exceeded|credits.?exhausted/iu.test(text) ||
    /allocationquota|exceeded.current.quota|\b1308\b/iu.test(text)
  )
    code = 'quota';
  else if (status === 429 || /rate.?limit|too.many.requests|\b130[25]\b/iu.test(text))
    code = 'rate';
  else if (status === 403) code = providerType === 'codex' ? 'login' : 'key';
  else if (status === 404 || /model.?not.?found|model.*not.*available/iu.test(text)) code = 'model';
  else if (/connection.?failed|stream.?disconnected|network/iu.test(text)) code = 'connection';
  else if (status === 400 || /context.*length|context.*window/iu.test(text)) code = 'context';
  const rawStatus = Number.isInteger(status) ? status : null;
  let resetAt = null;
  if (retryAfter) {
    resetAt = /^\d+$/u.test(retryAfter)
      ? Date.now() + Number(retryAfter) * 1000
      : Date.parse(retryAfter);
    if (!Number.isFinite(resetAt) || resetAt <= Date.now()) resetAt = null;
  }
  return new ReadingError(code, { status: rawStatus, resetAt });
}

export function diagnosticText({ version, zoteroVersion, system, provider, error }) {
  const model = provider?.model || 'default';
  const safeModel =
    /^[a-z0-9][a-z0-9._:/-]{0,119}$/iu.test(model) &&
    !/^(?:sk-|AIza|[a-z]:)|(?:users|home)\//iu.test(model)
      ? model
      : '[已省略]';
  return JSON.stringify(
    {
      pluginVersion: version,
      zoteroVersion,
      system,
      provider: ['codex', 'deepseek', 'openai'].includes(provider?.type)
        ? provider.type
        : 'unknown',
      model: safeModel,
      error: /^[a-z-]{1,40}$/u.test(error.code || '') ? error.code : 'local',
      status: Number.isInteger(error.status) ? error.status : null,
      rpcCode: Number.isInteger(error.rpcCode) ? error.rpcCode : null,
    },
    null,
    2,
  );
}
