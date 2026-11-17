import { readChatStream } from './event-stream.js';
import { serviceError } from '../domain/service-error.js';
import { ReadingError } from '../domain/errors.js';

export async function runChatCompletion(provider, request, dependencies) {
  const { fetch, key, signal, onText } = dependencies;
  if (!key) throw Object.assign(new ReadingError('key'), { status: 401 });
  const messages = request.messages.map((message) => ({ ...message }));
  const last = messages.at(-1);
  if (request.images.length) {
    last.content = [
      { type: 'text', text: last.content },
      ...request.images.map((image) => ({
        type: 'image_url',
        image_url: { url: image.dataURL },
      })),
    ];
  }
  const response = await fetch(provider.baseURL.replace(/\/$/u, '') + '/chat/completions', {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      ...(dependencies.project && { 'x-goog-user-project': dependencies.project }),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true,
      ...(provider.effort ? { reasoning_effort: provider.effort } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw serviceError(
      response.status,
      body.error || body,
      provider.type,
      response.headers?.get('retry-after'),
    );
  }
  return readChatStream(response.body, onText);
}
