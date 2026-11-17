import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterSections } from '../src/domain/summary.js';
import { parseAnswer } from '../src/domain/answer.js';

const page = (pageIndex, lines) => ({
  pageIndex,
  text: lines.join('\n'),
  paragraphs: lines.map((text, index) => ({ id: `p${pageIndex + 1}-${index}`, pageIndex, text })),
});

test('章节优先取 PDF 目录，参考文献不单列', () => {
  const pages = [
    page(0, ['标题']),
    page(1, ['正文']),
    page(2, ['正文']),
    page(3, ['参考']),
    page(4, ['文献']),
  ];
  const outline = [
    { title: 'Introduction', index: 0, depth: 0 },
    { title: 'Method', index: 2, depth: 0 },
    { title: 'References', index: 3, depth: 0 },
  ];
  assert.deepEqual(
    chapterSections(pages, outline).map((section) => [section.title, section.pages]),
    [
      ['Introduction', [0, 1]],
      ['Method', [2]],
    ],
  );
});

test('无目录时从正文标题识别章节，缺标题时按页段分组', () => {
  const headed = [
    page(0, ['1 Introduction', '文字']),
    page(1, ['2 Method', '文字']),
    page(2, ['3 Results', '文字']),
    page(3, ['References', '[1] Smith J.']),
  ];
  assert.deepEqual(
    chapterSections(headed, []).map((section) => section.title),
    ['1 Introduction', '2 Method', '3 Results'],
  );
  const plain = Array.from({ length: 10 }, (_, index) => page(index, ['正文']));
  assert.equal(chapterSections(plain, []).length, 4);
  assert.ok(chapterSections(plain, []).every((section) => !section.named));
  const headers = [0, 1, 2].map((index) => page(index, [`23 Page ${index + 1} of 3`, '文字']));
  assert.ok(chapterSections(headers, []).every((section) => !section.named));
});

test('background claim 可解析且不需要出处', () => {
  const raw = JSON.stringify({
    answer: '背景',
    claims: [{ text: '领域背景说明。', kind: 'background', citations: [] }],
  });
  const answer = parseAnswer(raw, { sources: [] });
  assert.equal(answer.claims.length, 1);
  assert.equal(answer.claims[0].kind, 'background');
});
