import { serviceError } from '../domain/service-error.js';
import { ReadingError } from '../domain/errors.js';

export const codexArguments = ['app-server', '--listen', 'stdio://'];

export async function initializeCodex(client) {
  const result = await client.request('initialize', {
    clientInfo: { name: 'zotero-reading-companion', version: '0.4.0' },
    capabilities: { experimentalApi: false },
  });
  await client.notify('initialized');
  return result;
}

export async function startCodexThread(client, request, { provider, directory }) {
  return client.request('thread/start', {
    model: provider.model || null,
    cwd: directory,
    ephemeral: true,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    baseInstructions: request.messages[0].content,
    config: {
      'features.shell_tool': false,
      'features.multi_agent': false,
      'features.apps': false,
      web_search: 'disabled',
    },
  });
}

export async function runCodexTurn(client, request, options) {
  const { provider, directory, signal, onText } = options;
  const started =
    options.started || (await startCodexThread(client, request, { provider, directory }));
  options.onModel?.(started.model || provider.model);
  const threadId = started.thread.id;
  let turnId;
  let unsubscribe;
  let finalText = '';
  const commentaryItems = new Set();
  let interrupted = false;

  const completed = new Promise((resolve, reject) => {
    unsubscribe = client.onNotification((method, params) => {
      if (method === 'client/closed') {
        reject(params.error);
        return;
      }
      if (params.threadId !== threadId) return;
      if (method === 'item/started' && params.item?.type === 'agentMessage') {
        if (params.item.phase === 'commentary') commentaryItems.add(params.item.id);
        if (params.item.phase === 'final_answer') finalText = '';
      }
      if (method === 'item/agentMessage/delta' && !commentaryItems.has(params.itemId)) {
        finalText += params.delta;
        onText?.(finalText);
      }
      if (
        method === 'item/completed' &&
        params.item?.type === 'agentMessage' &&
        params.item.phase !== 'commentary' &&
        !commentaryItems.has(params.item.id)
      ) {
        finalText = params.item.text || finalText;
      }
      if (method === 'turn/completed') {
        if (interrupted || params.turn.status === 'interrupted') {
          reject(new ReadingError('cancelled'));
        } else if (params.turn.status === 'failed') {
          const error = params.turn.error || {};
          const info = error.codexErrorInfo;
          const detail = typeof info === 'object' ? Object.values(info || {})[0] : null;
          reject(
            serviceError(
              detail?.httpStatusCode,
              {
                code: typeof info === 'string' ? info : Object.keys(info || {})[0],
                message: error.message,
              },
              'codex',
            ),
          );
        } else {
          resolve(finalText);
        }
      }
    });
  });
  // Attach rejection handling before the start RPC; notifications may arrive before its response.
  completed.catch(() => {});
  const interrupt = () => {
    interrupted = true;
    if (turnId) client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
  };
  signal.addEventListener('abort', interrupt, { once: true });
  try {
    if (signal.aborted) throw new ReadingError('cancelled');
    const input = [
      {
        type: 'text',
        text: request.messages
          .slice(1)
          .map((message) => message.content)
          .join('\n'),
      },
      ...request.images.map((image) => ({ type: 'image', url: image.dataURL })),
    ];
    const result = await client.request('turn/start', {
      threadId,
      input,
      ...(options.effort ? { effort: options.effort } : {}),
    });
    turnId = result.turn.id;
    if (signal.aborted) interrupt();
    return await completed;
  } finally {
    signal.removeEventListener('abort', interrupt);
    unsubscribe?.();
    if (options.release) client.request('thread/unsubscribe', { threadId }).catch(() => {});
  }
}
