import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureEvidence,
  selectEvidence,
  describePage,
  resolveCitation,
} from '../src/domain/evidence.js';
import { retrieveSources } from '../src/domain/retrieval.js';
import { composeRequest } from '../src/domain/prompt.js';
import { sameDocument } from '../src/domain/identity.js';
import { correctTerm } from '../src/domain/glossary.js';
import { view, snapshot, specification } from './helpers.js';

test('发送后翻页、改选区与替换 canvas 数据不改变快照', () => {
  const state = view();
  state.selection = { text: 'DATA', positions: [{ rects: [[1, 2, 3, 4]] }] };
  const evidence = captureEvidence(state, 'fixed');
  state.pageIndex = 9;
  state.selection.positions[0].rects[0][0] = 99;
  state.images[0].dataURL = 'changed';
  assert.equal(evidence.pageIndex, 1);
  assert.equal(evidence.selection.positions[0].rects[0][0], 1);
  assert.notEqual(evidence.images[0].dataURL, 'changed');
  assert.throws(() => {
    evidence.images.push({});
  }, TypeError);
});

test('追问沿用上轮，明确现在切换；不同文献隔离', () => {
  const previous = captureEvidence(view(), 'previous');
  const current = captureEvidence(view('1-EXAMPLE', 3), 'current');
  assert.equal(selectEvidence('为什么', current, previous), previous);
  assert.equal(selectEvidence('请举一个反例并详细解释', current, previous), previous);
  assert.equal(selectEvidence('那现在这张图呢', current, previous), current);
  assert.equal(selectEvidence('为什么', current, previous, 'current'), current);
  const otherDocument = captureEvidence(view('2-OTHER', 0), 'other');
  assert.equal(selectEvidence('为什么', otherDocument, previous), otherDocument);
});

test('文件页序与印刷页码分开，支持罗马数字与无标签', () => {
  assert.equal(describePage(1, 'ii'), 'PDF 第 2 页 · 印刷页码 ii');
  assert.equal(describePage(18), 'PDF 第 19 页');
});

test('检索使跨页握手条款与图同轮发送，预算不在段落中截断', () => {
  const sources = retrieveSources(specification, captureEvidence(view(), 'figure'), '第三拍');
  assert.ok(sources.some((source) => source.pageIndex === 0));
  assert.ok(sources.some((source) => source.pageIndex === 1));
  const bounded = retrieveSources(specification, captureEvidence(view(), 'figure'), '', false, 100);
  assert.ok(bounded.reduce((size, source) => size + source.text.length, 0) <= 100);
});

test('提示词与 UI 范围从同一快照派生，未知模型不能悄悄声称收到了图', () => {
  const evidence = snapshot();
  const request = composeRequest({
    question: '第三拍为什么不能换数据？',
    snapshot: evidence,
    provider: { id: 'unknown', type: 'openai', model: 'text', context: 32000 },
  });
  assert.equal(request.images.length, 0);
  assert.match(request.scope, /仅文本/u);
  const sent = JSON.parse(request.messages[1].content).evidence;
  assert.equal(sent.id, evidence.id);
  assert.deepEqual(
    sent.sources.map((source) => source.paragraphs),
    evidence.sources.map((source) => source.paragraphs),
  );
  assert.match(request.messages[0].content, /不能从图没变化推断禁止变化/u);
  assert.match(request.messages[0].content, /因果边界/u);
});

test('引用只解析发送过的出处，匹配原文后才启用坐标高亮', () => {
  const evidence = snapshot();
  const citation = resolveCitation(evidence, {
    sourceId: 'page-1',
    paragraphId: 'p1-0',
    quote: 'DATA stable',
  });
  assert.equal(citation.verifiedQuote, true);
  assert.equal(citation.position.pageIndex, 0);
  assert.equal(resolveCitation(evidence, { sourceId: 'page-999' }), null);
  const wrongQuote = resolveCitation(evidence, { sourceId: 'page-1', quote: 'fabricated' });
  assert.equal(wrongQuote.position, null);
  assert.match(wrongQuote.quote, /HOLD/u);
});

test('去重保留同名不同 DOI、arXiv 版本及缺少身份的条目', () => {
  assert.equal(sameDocument({ title: 'Same' }, { title: 'Same' }), false);
  assert.equal(sameDocument({ DOI: '10.1/a' }, { DOI: '10.1/b' }), false);
  assert.equal(sameDocument({ DOI: 'https://doi.org/10.1/ABC' }, { DOI: '10.1/abc' }), true);
  assert.equal(
    sameDocument(
      { url: 'https://arxiv.org/abs/1706.03762v1' },
      { url: 'https://arxiv.org/abs/1706.03762v2' },
    ),
    false,
  );
});

test('术语按语境修正，不改写之前的术语表或其他文献', () => {
  const first = correctTerm([], 'cell', '细胞', 'biology');
  const second = correctTerm(first, 'cell', '单元', 'IC');
  const revised = correctTerm(second, 'cell', '存储单元', 'IC');
  assert.equal(first.length, 1);
  assert.equal(revised.length, 2);
  assert.equal(revised[1].translation, '存储单元');
});
