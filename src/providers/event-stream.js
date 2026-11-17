import { ReadingError } from '../domain/errors.js';
import { serviceError } from '../domain/service-error.js';

export async function readChatStream(body, onText) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finished = false;
  try {
    while (!finished) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/gu, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        if (data === '[DONE]') {
          finished = true;
          break;
        }
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          throw new ReadingError('protocol');
        }
        if (chunk.error) throw serviceError(chunk.error.status, chunk.error);
        const choice = chunk.choices?.[0];
        // reasoning_content and other reasoning fields are intentionally never copied.
        if (typeof choice?.delta?.content === 'string') {
          text += choice.delta.content;
          onText?.(text);
        }
        if (choice?.finish_reason === 'length') throw new ReadingError('context');
        if (choice?.finish_reason === 'stop') finished = true;
      }
    }
    if (!finished || !text) throw new ReadingError('protocol');
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
