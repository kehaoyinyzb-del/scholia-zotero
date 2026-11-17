import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { prepareNotebook, parseNotebook, pageList } from '../src/domain/notebook.js';
import { notebookHTML } from '../src/runtime/notebook.js';

const position = { pageIndex: 1, rects: [[1, 2, 3, 4]] };
const pages = [0, 1, 2].map((pageIndex) => ({
  pageIndex,
  paragraphs: [{ id: `p${pageIndex}`, text: `Page ${pageIndex + 1}`, position }],
}));
const annotations = [{ key: 'ABC', text: 'Page 2', comment: '我的纠正', position }];
const input = { pages, annotations, turns: [], scope: 'discussion', currentPage: 0, budget: 5000 };

test('笔记覆盖由实际纳入来源计算，不把标注页写成全篇', () => {
  const material = prepareNotebook(input);
  assert.equal(material.annotationCount, 1);
  assert.deepEqual(material.includedPages, [1]);
  assert.match(material.coverage, /第 1、3 页未覆盖/u);
  assert.equal(pageList([0, 1, 2, 5]), '1–3、6');
  const chapter = prepareNotebook({ ...input, scope: 'chapter', currentPage: 2 });
  assert.match(chapter.coverage, /未识别到章节/u);
  assert.deepEqual(chapter.includedPages, [2]);
  const limited = prepareNotebook({ ...input, scope: 'all', budget: 190 });
  assert.match(limited.coverage, /长度限制使 3 段正文/u);
  assert(limited.characters <= 190);
});

test('每条笔记必须有真实来源，拒绝模型编造 ID 和没有出处的要点', () => {
  const material = prepareNotebook(input);
  const value = {
    title: '笔记',
    sections: [
      { title: '要点', points: [{ text: '结论', kind: 'inference', sources: ['a-ABC'] }] },
    ],
  };
  assert.equal(parseNotebook(JSON.stringify(value), material).sections.length, 1);
  value.sections[0].points[0].sources = ['invented'];
  assert.throws(() => parseNotebook(JSON.stringify(value), material), { code: 'protocol' });
  value.sections[0].points[0].sources = [];
  assert.throws(() => parseNotebook(JSON.stringify(value), material), { code: 'protocol' });
});

test('讨论按具体陈述绑定全部真实出处，不把完整回答任意挂在检索页上', () => {
  const turn = {
    id: 'turn',
    question: '两个结果如何比较？',
    snapshot: { sources: pages.map((page) => ({ ...page, text: '原文' })) },
    answer: {
      text: '第 1 页结果 A，第 3 页结果 B。',
      claims: [
        {
          text: '结果 A',
          kind: 'text',
          citations: [{ pageIndex: 0, quote: 'Result A', verifiedQuote: true }],
        },
        {
          text: '比较 A 和 B',
          kind: 'inference',
          citations: [
            { pageIndex: 0, quote: 'Result A', verifiedQuote: true },
            { pageIndex: 2, quote: 'Result B', verifiedQuote: true },
          ],
        },
      ],
    },
  };
  const material = prepareNotebook({ ...input, turns: [turn], budget: 5000 });
  const sources = material.sources.filter((source) => source.kind === 'discussion');
  assert.equal(sources.length, 2);
  assert.equal(sources[0].text, '结果 A');
  assert.deepEqual(
    sources[0].references.map((reference) => reference.pageIndex),
    [0],
  );
  assert.deepEqual(
    sources[1].references.map((reference) => reference.pageIndex),
    [0, 2],
  );
  assert(
    sources.every((source) => !source.references.some((reference) => reference.pageIndex === 1)),
  );
  assert.equal(material.turnCount, 1);
  const document = new JSDOM('<html></html>').window.document;
  const zotero = {
    getMainWindow: () => ({ document }),
    Items: { get: () => ({ id: 3 }) },
    Libraries: { get: () => ({ libraryType: 'user' }) },
    URI: { getItemURI: () => 'http://zotero.org/users/local/test/items/PDF' },
  };
  const html = notebookHTML(
    zotero,
    {
      title: '比较',
      material,
      sections: [
        {
          title: '结果',
          points: [{ text: 'A 和 B', kind: 'inference', sources: [sources[1].id] }],
        },
      ],
    },
    { document: { key: 'PDF', itemID: 3, libraryID: 1 } },
  );
  const links = [...new JSDOM(html).window.document.querySelectorAll('a')];
  assert.deepEqual(
    links.map((link) => new URL(link.href).searchParams.get('page')),
    ['1', '3'],
  );
});

test('原生笔记保留公式格式、表格、用户原话与正确页码及标注键', () => {
  const document = new JSDOM('<html></html>').window.document;
  const material = prepareNotebook(input);
  const draft = {
    title: '<script>不是 HTML</script>',
    material,
    sections: [
      {
        title: '验证',
        points: [
          {
            kind: 'inference',
            sources: ['a-ABC'],
            text: '$x^2$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
          },
        ],
      },
    ],
  };
  const zotero = {
    getMainWindow: () => ({ document }),
    Items: { get: () => ({ id: 3 }) },
    Libraries: { get: () => ({ libraryType: 'user' }) },
    URI: { getItemURI: () => 'http://zotero.org/users/local/test/items/PDF' },
  };
  const html = notebookHTML(zotero, draft, { document: { key: 'PDF', itemID: 3, libraryID: 1 } });
  const result = new JSDOM(html).window.document;
  assert.equal(result.querySelector('script'), null);
  assert.equal(result.querySelector('span.math').textContent, '$x^2$');
  assert.equal(result.querySelectorAll('table').length, 1);
  assert.match(result.querySelector('a').href, /page=2&annotation=ABC/u);
  const metadata = JSON.parse(
    decodeURIComponent(result.querySelector('[data-annotation]').getAttribute('data-annotation')),
  );
  assert.equal(metadata.annotationKey, 'ABC');
  assert.equal(metadata.position.pageIndex, 1);
  assert.match(result.body.textContent, /我的纠正/u);
});

test('划线整理用原始评论替换模型改写，并标明补充', () => {
  const comment = '我的第一句话。\n第二句保留 2.50 V 与 **原样标记**。';
  const material = {
    scope: 'annotations-plus',
    sources: [
      { id: 'a-1', kind: 'annotation', text: 'Original words.', comment, pageIndex: 0 },
      { id: 'p-2', kind: 'original', text: 'Additional source.', pageIndex: 1 },
    ],
  };
  const raw = JSON.stringify({
    title: '笔记',
    sections: [
      {
        title: '主题',
        points: [
          { text: '模型改写的评论', kind: 'user', sources: ['a-1'] },
          { text: '额外内容', kind: 'text', sources: ['p-2'] },
        ],
      },
    ],
  });
  const draft = parseNotebook(raw, material);
  assert.equal(draft.sections[0].points[1].text, comment);
  assert.equal(draft.sections[0].points[2].added, true);
  assert.ok(!JSON.stringify(draft.sections).includes('模型改写的评论'));
});
