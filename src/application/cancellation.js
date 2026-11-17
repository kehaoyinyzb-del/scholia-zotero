import { ReadingError } from '../domain/errors.js';

export function awaitWithSignal(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new ReadingError('cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', abort);
      });
    if (signal.aborted) abort();
  });
}
