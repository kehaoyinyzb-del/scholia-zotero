import { apiModel } from '../domain/api-models.js';
import { serviceError } from '../domain/service-error.js';

// The official catalogs also contain entries for embedding, speech and media endpoints.
function chatModel(host, entry) {
  const id = entry.id || entry.model;
  if (typeof id !== 'string') return false;
  if (host === 'generativelanguage.googleapis.com') {
    const name = id.replace(/^models\//u, '');
    return (
      /^(gemini-|gemma-)/u.test(name) && !/embedding|image|audio|tts|live|robotics/iu.test(name)
    );
  }
  if (host === 'api.openai.com') {
    const specialized = /audio|tts|transcribe|realtime|image|codex|deep-research|instruct|live/u;
    return /^(gpt-|chatgpt-|o[1-9]|ft:)/u.test(id) && !specialized.test(id);
  }
  return true;
}

export async function readAPICatalog(provider, { fetch, key, project, signal }) {
  const base = provider.baseURL.replace(/\/$/u, '');
  const url = new URL(base);
  const dashscope =
    /(^|\.)(?:dashscope(?:-intl|-us)?|[^.]+\.maas)\.aliyuncs\.com$/u.test(url.hostname) &&
    url.pathname === '/compatible-mode/v1';
  let page = 1;
  const models = [];
  do {
    const endpoint = dashscope
      ? `${url.origin}/api/v1/models?capabilities=TG&page_size=100&page_no=${page}`
      : `${base}/models`;
    const response = await fetch(endpoint, {
      headers: {
        ...(project && { 'x-goog-user-project': project }),
        Authorization: `Bearer ${key}`,
      },
      redirect: 'error',
      signal,
    });
    const body = await response.json();
    if (!response.ok || body.success === false)
      throw serviceError(response.status, body.error || body, provider.type);
    const entries = dashscope ? body.output?.models : body.data;
    if (!Array.isArray(entries)) throw new Error('Invalid model catalog');
    models.push(
      ...entries
        .filter((entry) => chatModel(url.hostname, entry))
        .map((entry) => {
          if (url.hostname === 'generativelanguage.googleapis.com')
            return apiModel({ ...entry, id: (entry.id || entry.model).replace(/^models\//u, '') });
          return apiModel(entry);
        }),
    );
    if (!dashscope || !entries.length || page * 100 >= body.output.total) break;
    page += 1;
  } while (!signal.aborted);
  return models;
}
