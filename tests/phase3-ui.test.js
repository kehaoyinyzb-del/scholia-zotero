import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTurn } from '../src/ui/turn.js';
import { snapshot } from './helpers.js';

test('上标出处含原文提示，未核对出处明确区分且可回跳', () => {
  const dom = new JSDOM('');
  let selected;
  const citation = { pageIndex: 1, quote: 'original', verifiedQuote: false };
  const turn = {
    id: 'a',
    question: 'why',
    state: 'complete',
    snapshot: snapshot(),
    provider: { name: 'test' },
    scope: '本页',
    answer: {
      text: '说明',
      claims: [{ kind: 'inference', text: '推导', citations: [citation] }],
      uncertainties: [],
      coverage: '本页',
    },
  };
  const node = renderTurn(dom.window.document, turn, {
    navigate: (_snapshot, source) => {
      selected = source;
    },
  });
  const reference = node.querySelector('.rc-citation');
  assert.ok(reference.classList.contains('rc-unverified'));
  assert.match(reference.title, /未在原文中逐字找到/u);
  assert.equal(node.querySelector('blockquote'), null);
  reference.click();
  assert.equal(selected, citation);
  dom.window.close();
});

test('页条默认沿用旧页，点击切换后确实选择正在阅读的新页', async () => {
  const { ReadingPanel } = await import('../src/ui/panel.js');
  const { defaultConfiguration } = await import('../src/domain/configuration.js');
  const dom = new JSDOM('<main></main>');
  const panel = new ReadingPanel(dom.window.document, dom.window.document.querySelector('main'), {
    store: { configuration: () => defaultConfiguration },
    reader: {
      active: () => null,
      current: () => {
        throw new Error('No reader');
      },
    },
    sessions: { subscribe: () => () => {}, running: new Map() },
  });
  try {
    panel.latestSnapshot = snapshot();
    panel.viewState = { ...panel.latestSnapshot, pageIndex: 4 };
    panel.renderBasis(panel.viewState);
    assert.equal(panel.basisTarget.pageIndex, 1);
    panel.fixed.click();
    assert.equal(panel.basisTarget.pageIndex, 4);
  } finally {
    panel.destroy();
    dom.window.close();
  }
});
