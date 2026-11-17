import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportQueue } from '../src/application/import-queue.js';
import { recoverImport, moveImport } from '../src/domain/import-state.js';
import { memoryStore } from './helpers.js';

test('并发双击、网络重试和 PDF 补存只创建一次父条目', async () => {
  const parents = [];
  let hasPDF = false;
  const repository = {
    validateDestination: async () => {},
    translate: async () => ({
      itemType: 'journalArticle',
      title: 'Article',
      DOI: '10.1/article',
      attachments: [{ url: 'https://example.org/file.pdf', mimeType: 'application/pdf' }],
    }),
    findExisting: async () => parents[0]?.id,
    createParent: async (metadata) => {
      parents.push({ ...metadata, id: 1 });
      return 1;
    },
    hasPDF: async () => hasPDF,
    downloadPDF: async () => false,
    attachBytes: async () => {
      hasPDF = true;
    },
  };
  const queue = new ImportQueue(repository, memoryStore());
  await queue.initialize();
  const input = { id: 'request-1234', url: 'https://example.org/article', html: '<html/>' };
  await Promise.all([
    queue.submit(input, { libraryID: 1 }),
    queue.submit(input, { libraryID: 1 }),
    queue.submit({ ...input, id: 'request-5678' }, { libraryID: 1 }),
  ]);
  await queue.queue;
  assert.equal(parents.length, 1);
  assert.equal(queue.status(input.id).state, 'partial');
  await queue.submit(input, { libraryID: 1 });
  await queue.queue;
  assert.equal(parents.length, 1);
  await queue.supplement({ id: input.id, url: 'https://example.org/file.pdf', base64: 'PDF' });
  assert.equal(queue.status(input.id).hasPDF, true);
  assert.equal(parents.length, 1);
});

test('重启恢复不会把进行中任务误报为成功，成功状态禁止重新开始', () => {
  assert.equal(recoverImport({ state: 'pdf', itemID: 1 }).state, 'partial');
  assert.equal(recoverImport({ state: 'detecting' }).state, 'failed');
  assert.throws(() => moveImport({ state: 'complete' }, 'detecting'));
});
