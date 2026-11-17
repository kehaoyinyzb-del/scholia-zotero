import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryChunks, summarySources, pageRanges } from '../src/domain/summary.js';

test('全文分块保留跨块长段的全部文字和真实页序', () => {
  const text = '前半段'.repeat(100) + '后半段'.repeat(100);
  const sources = summarySources([
    { pageIndex: 2, text, paragraphs: [{ id: 'p3-0', text }] },
    { pageIndex: 3, text: '', paragraphs: [] },
  ]);
  const chunks = summaryChunks(sources, 80);
  assert.equal(
    chunks
      .flatMap((chunk) => chunk.flatMap((source) => source.paragraphs))
      .map((paragraph) => paragraph.text)
      .join(''),
    text,
  );
  assert.ok(chunks.every((chunk) => chunk.every((source) => source.pageIndex === 2)));
  assert.equal(pageRanges([2, 3, 4, 7]), '3–5、8');
});

test('超长引用保留可发送的前缀与截取计数，清除不再准确的位置', async () => {
  const { addReference, referenceSources } = await import('../src/domain/references.js');
  const references = addReference([], {
    text: '原文'.repeat(5000),
    pageIndex: 2,
    position: { pageIndex: 2 },
  });
  assert.equal(references[0].text.length, 8000);
  assert.equal(references[0].originalLength, 10000);
  assert.equal(references[0].position, null);
  assert.equal(referenceSources(references)[0].truncated, true);
});
