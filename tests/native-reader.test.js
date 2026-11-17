import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNativePage } from '../src/domain/native-pdf.js';
import { ReaderAdapter } from '../src/runtime/reader.js';
import { readFile } from 'node:fs/promises';

const characters = [
  { c: '5', inlineRect: [50, 10, 55, 20], lineBreakAfter: true, paragraphBreakAfter: true },
  { c: 'Title', inlineRect: [50, 700, 150, 715], lineBreakAfter: true, paragraphBreakAfter: true },
  { c: 'Findings cannot establish', inlineRect: [50, 600, 250, 610], lineBreakAfter: true },
  {
    c: 'causality.',
    inlineRect: [50, 584, 150, 594],
    lineBreakAfter: true,
    paragraphBreakAfter: true,
  },
];

test('原生字符跨物理行合并否定命题，页脚按坐标排在正文后', () => {
  const page = extractNativePage(characters, 0, 612, 'i');
  assert.equal(page.paragraphs[0].text, 'Title');
  assert.equal(page.paragraphs[1].text, 'Findings cannot establish causality.');
  assert.equal(page.paragraphs.at(-1).text, '5');
});

test('Zotero 10 adapter 使用 getPageData 和 cloneInto，不依赖不存在的 getTextContent', async () => {
  const frame = {};
  let cloned = false;
  const pdfDocument = {
    numPages: 1,
    getPageLabels: async () => ['i'],
    getPage: async () => ({
      getViewport: (parameters) => {
        assert.equal(parameters.realm, frame);
        assert.equal(parameters.scale, 1);
        return { viewBox: [0, 0, 612, 792] };
      },
    }),
    getPageData: async (parameters) => {
      assert.equal(parameters.realm, frame);
      return { chars: characters };
    },
  };
  frame.PDFViewerApplication = { pdfDocument, pdfViewer: { currentPageNumber: 1 } };
  const reader = { itemID: 1, _internalReader: { _lastView: { _iframeWindow: frame } } };
  const adapter = new ReaderAdapter(
    {
      Items: { get: () => ({ id: 1, key: 'EXAMPLE', libraryID: 1 }) },
    },
    () => 'id',
    {
      utils: {
        cloneInto(parameters, realm) {
          cloned = true;
          return { ...parameters, realm };
        },
      },
    },
  );
  const pages = await adapter.pages(reader);
  assert.equal(cloned, true);
  assert.equal(pages[0].printedPage, 'i');
  assert.equal(pages[0].geometry.source, 'page-viewport');
  assert.equal(pages[0].geometry.width, 612);
  assert.match(pages[0].text, /cannot establish causality/u);
});

test('安装清单含 Zotero 10 必需字段，Fluent 使用属性避免覆盖侧栏子节点', async () => {
  const manifest = JSON.parse(await readFile('addon/manifest.json', 'utf8'));
  assert.ok(manifest.applications.zotero.update_url);
  assert.equal(manifest.applications.zotero.strict_max_version, '10.*');
  const localization = await readFile('addon/locale/en-US/reading-companion.ftl', 'utf8');
  assert.match(localization, /reading-companion-title =\s*\n\s+\.label =/u);
});

test('双栏同一物理行先拆开，再按栏顺序读取', () => {
  const chars = [];
  for (let index = 0; index < 10; index++) {
    const y = 700 - index * 16;
    chars.push({
      c: `Left paragraph sentence number ${index}.`,
      inlineRect: [120, y, 330, y + 10],
    });
    chars.push({
      c: `Right paragraph sentence number ${index}.`,
      inlineRect: [350, y, 560, y + 10],
      lineBreakAfter: true,
      paragraphBreakAfter: true,
    });
  }
  const page = extractNativePage(chars, 0, 612);
  assert.ok(page.text.indexOf('Left paragraph sentence number 9.') < page.text.indexOf('Right'));
  assert.equal(page.paragraphs.length, 20);
});
