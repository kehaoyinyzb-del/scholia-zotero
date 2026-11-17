import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideEvidence, captureEvidence } from '../src/domain/evidence.js';
import { geometryFromBox } from '../src/domain/page-geometry.js';
import { extractNativePage } from '../src/domain/native-pdf.js';
import { validateTranslation } from '../src/domain/translation.js';
import { errorFeedback } from '../src/domain/errors.js';
import { ReaderAdapter } from '../src/runtime/reader.js';
import { ReadingSession } from '../src/application/reading-session.js';
import { defaultConfiguration } from '../src/domain/configuration.js';
import { view, specification, memoryStore } from './helpers.js';

const wording = [
  ['为什么？', 'previous'],
  ['这一页为什么这样写', 'previous'],
  ['当前的结论可靠吗', 'previous'],
  ['给个例子', 'previous'],
  ['那现在这张图呢', 'current'],
  ['这张新的说明什么', 'current'],
  ['翻到的这页呢', 'current'],
  ['它有什么限制？', 'clarify'],
  ['当前是否允许改变？', 'clarify'],
];
for (const changed of [false, true]) {
  for (const [question, expected] of wording) {
    test(`依据矩阵：视图${changed ? '变化' : '不变'} × ${question}`, () => {
      const previous = captureEvidence(view(), 'prior');
      const current = captureEvidence(view('1-EXAMPLE', changed ? 3 : 1), 'now');
      const result = decideEvidence(question, current, previous);
      assert.equal(result.choice, changed ? expected : 'previous');
      assert.equal(result.viewChanged, changed);
      if (result.choice === 'clarify') assert.equal(result.evidence, null);
    });
  }
}

test('同页选区与裁剪改变也需消歧；重绘像素不当成视图变化', () => {
  const previous = captureEvidence(view(), 'prior');
  const current = view();
  current.images[0].dataURL = 'repainted pixels';
  assert.equal(
    decideEvidence('它呢', captureEvidence(current, 'new'), previous).choice,
    'previous',
  );
  current.selection = { text: 'new selection' };
  assert.equal(decideEvidence('它呢', captureEvidence(current, 'new'), previous).choice, 'clarify');
  current.selection = null;
  current.images[0].region = { left: 0, top: 0.2, right: 1, bottom: 1 };
  assert.equal(decideEvidence('它呢', captureEvidence(current, 'new'), previous).choice, 'clarify');
});

test('页面尺寸依次使用真实视口、远页 getViewport、文字边界；缺失有准确错误', async () => {
  const adapter = new ReaderAdapter({}, () => 'id', { utils: { cloneInto: (value) => value } });
  const frame = { _iframeWindow: {} };
  let queried = 0;
  const application = {
    pdfViewer: { getPageView: () => ({ viewport: { viewBox: [12, 20, 624, 812] } }) },
    pdfDocument: {
      getPage: async () => {
        queried++;
        throw new Error('not rendered');
      },
    },
  };
  const rendered = await adapter.geometry(application, frame, 0, {}, []);
  assert.equal(rendered.width, 612);
  assert.equal(rendered.left, 12);
  assert.equal(queried, 0);
  application.pdfViewer.getPageView = () => undefined;
  const fallback = await adapter.geometry(application, frame, 9, {}, [
    { inlineRect: [48, 120, 560, 140] },
  ]);
  assert.equal(fallback.source, 'text-bounds');
  await assert.rejects(adapter.geometry(application, frame, 9, {}, []), (error) => {
    assert.equal(errorFeedback(error).code, 'reader-geometry');
    assert.equal(errorFeedback(error).filePage, 10);
    return true;
  });
  for (const box of [undefined, [], [0, 0, NaN, 9], [20, 0, 10, 2]]) {
    assert.equal(geometryFromBox(box, 'test'), null);
  }
});

test('取字和跨运行环境克隆失败不显示为网络错误', async () => {
  const pdfDocument = {
    numPages: 1,
    getPageLabels: async () => null,
    getPageData: async () => {
      throw new Error('private diagnostic');
    },
  };
  const frame = { PDFViewerApplication: { pdfDocument, pdfViewer: { currentPageNumber: 1 } } };
  const reader = { itemID: 1, _internalReader: { _primaryView: { _iframeWindow: frame } } };
  const adapter = new ReaderAdapter(
    { Items: { get: () => ({ libraryID: 1, key: 'TEST' }) } },
    () => 'id',
    { utils: { cloneInto: (value) => value } },
  );
  await assert.rejects(adapter.pages(reader), (error) => {
    assert.equal(errorFeedback(error).code, 'reader-text');
    assert.equal(errorFeedback(error).filePage, 1);
    assert.doesNotMatch(JSON.stringify(errorFeedback(error)), /private diagnostic/u);
    return true;
  });
});

test('寄存器逐列原生字符保持表头对应，脚注和提前插入的页脚按坐标置后', () => {
  const characters = [{ c: 'Footer', inlineRect: [48, 10, 100, 20], paragraphBreakAfter: true }];
  for (const [index, cells] of [
    ['Offset', 'Name', 'Access', 'Reset'],
    ['0x00', 'CTRL', 'RW', '0'],
    ['0x04', 'STATUS', 'W1C [a]', '0'],
  ].entries()) {
    for (const [column, c] of cells.entries()) {
      characters.push({
        c,
        inlineRect: [48 + column * 120, 600 - index * 40, 100 + column * 120, 610 - index * 40],
        paragraphBreakAfter: true,
      });
    }
  }
  characters.push({
    c: '[a] Writing 0 shall not clear.',
    inlineRect: [48, 400, 350, 412],
    paragraphBreakAfter: true,
  });
  const result = extractNativePage(characters, 5, 612, '5');
  assert.equal(result.paragraphs[0].kind, 'table');
  assert.equal(result.paragraphs[0].columns, 4);
  assert.equal(result.paragraphs[0].rowCount, 3);
  assert.match(result.paragraphs[0].text, /\| 0x04 \| STATUS \| W1C \[a\] \| 0 \|/u);
  assert.match(result.paragraphs[1].text, /shall not clear/u);
  assert.equal(result.paragraphs.at(-1).text, 'Footer');
});

test('次数与人数错译、cannot 否定丢失、跨段与跨轮术语变化均标明', () => {
  const targets = [
    { id: 'a', text: 'Visits cannot establish that opening hours caused visits.' },
    { id: 'b', text: 'Unique visitors are distinct people.' },
  ];
  const result = validateTranslation(targets, [
    { id: 'a', original: targets[0].text, translation: '到馆人数证明开放时间导致到馆人数。' },
    { id: 'b', original: targets[1].text, translation: '独立访客是不同的人。' },
  ]);
  assert.equal(result.state, 'needs-review');
  assert.ok(result.rows[0].issues.some((issue) => issue.includes('visits')));
  assert.ok(result.rows[0].issues.some((issue) => issue.includes('否定')));
  const term = { source: 'branch', translation: '分馆', context: '' };
  const translated = (id, translation, terms = []) => ({
    id,
    original: 'This branch.',
    translation,
    terms,
  });
  const sameRound = validateTranslation(
    [
      { id: 'a', text: 'This branch.' },
      { id: 'b', text: 'This branch.' },
    ],
    [translated('a', '这个分馆。', [term]), translated('b', '这个分支。')],
  );
  assert.match(sameRound.rows[1].issues.join(), /branch/u);
  const later = validateTranslation(
    [{ id: 'b', text: 'This branch.' }],
    [translated('b', '这个分支。')],
    [],
    [term],
  );
  assert.match(later.rows[0].issues.join(), /branch/u);
});

test('歧义请求不调用模型；确认使用点选时提供的冻结依据而非随后翻到的页', async () => {
  let current = view();
  const store = memoryStore();
  let calls = 0;
  let choice;
  const sessions = new ReadingSession({
    reader: {
      capture: () => captureEvidence(current, 'capture'),
      current: () => current,
      pages: async () => specification,
    },
    store,
    models: {
      run: async () => {
        calls++;
        return '{"answer":"answer"}';
      },
    },
    identifier: () => `id-${calls}`,
    createAbortController: () => new AbortController(),
  });
  sessions.subscribe((_document, state) => {
    if (state.state === 'choose-evidence') choice = state;
  });
  const options = { question: '首问', purpose: 'ask', provider: defaultConfiguration.providers[0] };
  await sessions.send(options);
  current = view('1-EXAMPLE', 3);
  await sessions.send({ ...options, question: '它有什么限制？' });
  assert.equal(calls, 1);
  assert.equal((await store.session('1-EXAMPLE')).turns.length, 1);
  current = view('1-EXAMPLE', 0);
  const turn = await sessions.send({
    ...options,
    question: choice.question,
    mode: 'current',
    capturedEvidence: choice.current,
    discussionEvidence: choice.previous,
  });
  assert.equal(calls, 2);
  assert.equal(turn.sentEvidence.pageIndex, 3);
  assert.equal(turn.sentEvidence.decision.reason, 'explicit-control');
  current = view('2-OTHER', 0);
  await assert.rejects(sessions.send({ ...options, capturedEvidence: choice.current }), {
    code: 'reader-changed',
  });
  assert.equal(calls, 2);
});
