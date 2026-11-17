import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderRichText, renderTableTranslation, typesetText } from '../src/ui/rich-text.js';
import { renderTurn } from '../src/ui/turn.js';
import { snapshot } from './helpers.js';

test('公式渲染 MathML，模型 HTML 不执行，表格可横向滚动', () => {
  const document = new JSDOM('').window.document;
  const rendered = renderRichText(
    document,
    [
      '<script>unsafe()</script>',
      '公式 $V=IR$ 与 `DATA[7:0]`。',
      '| Edge | DATA |',
      '| --- | --- |',
      '| 3 | A |',
    ].join('\n'),
  );
  assert.equal(rendered.querySelectorAll('script').length, 0);
  assert.equal(rendered.querySelectorAll('math').length, 1);
  assert.equal(rendered.querySelector('code').textContent, 'DATA[7:0]');
  assert.ok(rendered.querySelector('.rc-table-scroll table thead th'));
  assert.equal(rendered.querySelector('.rc-table-scroll').getAttribute('tabindex'), '0');
});

test('表格对照逐格合并，相同值只显示一次，结构不匹配保留双表', () => {
  const document = new JSDOM('').window.document;
  const source = '| Offset | Action |\n| --- | --- |\n| 0x00 | Clear |';
  const target = '| 偏移量 | 操作 |\n| --- | --- |\n| 0x00 | 清除 |';
  const merged = renderTableTranslation(document, source, target);
  assert.equal(merged.querySelectorAll('table').length, 1);
  assert.equal(merged.textContent.match(/0x00/gu).length, 1);
  assert.equal(merged.querySelector('th').title, 'Offset');
  assert.match(merged.textContent, /清除Clear/u);
  assert.equal(renderTableTranslation(document, source, target + '\n| 0x04 | 保留 |'), null);
});

test('翻译疑点、依据与出处有独立可操作入口', () => {
  const document = new JSDOM('').window.document;
  const evidence = snapshot();
  const rendered = renderTurn(
    document,
    {
      question: '为什么？',
      snapshot: evidence,
      provider: { name: 'Test' },
      scope: 'PDF 1、2 页',
      state: 'needs-review',
      answer: {
        text: '解释',
        claims: [],
        coverage: '当前段',
        uncertainties: [],
        translation: {
          state: 'needs-review',
          globalIssues: [],
          rows: [
            {
              original: '3 ns',
              translation: '等待',
              issues: ['请核对数值 3。'],
            },
          ],
        },
      },
    },
    {},
  );
  assert.equal(
    rendered.querySelector('.rc-translation-review summary').getAttribute('aria-label'),
    '译文待核对',
  );
  assert.match(rendered.textContent, /请核对数值 3/u);
  assert.equal(rendered.querySelector('.rc-sent-page'), null);
});

test('长等式逐行对齐，求和上下标内的等号保持原式', () => {
  const document = new JSDOM('').window.document;
  const expression = String.raw`C_Y = \frac{1}{n}YY^T = \frac{1}{n}PXX^TP^T = PC_XP^T = D`;
  const rendered = renderRichText(document, `$$${expression}$$`);
  assert.ok(rendered.querySelector('mtable'));
  assert.equal(rendered.querySelectorAll('mtr').length, 4);
  const sum = String.raw`\sum_{i=1}^{n} x_i = \sum_{i=1}^{n} y_i`;
  assert.equal(renderRichText(document, `$$${sum}$$`).querySelector('mtable'), null);
});

test('中西文间距、数值与单位、范围字符保持原样，代码与公式不受影响', () => {
  assert.equal(
    typesetText('术后24小时用量4.0mg（95%置信区间1.2～4.3）'),
    '术后 24 小时用量 4.0\u00A0mg（95% 置信区间 1.2～4.3）',
  );
  assert.equal(typesetText('H2O 与 1990s 保持原样'), 'H2O 与 1990s 保持原样');
  const document = new JSDOM('').window.document;
  const rendered = renderRichText(document, '保持`DATA[7:0]`和$x_1$不变，RCT不是代码');
  assert.equal(rendered.querySelector('code').textContent, 'DATA[7:0]');
  assert.equal(rendered.querySelectorAll('code').length, 1);
  assert.match(rendered.textContent, /^保持 DATA\[7:0\] 和 /u);
  assert.match(rendered.textContent, /不变，RCT 不是代码$/u);
});
