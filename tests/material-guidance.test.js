import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialGuidance } from '../src/domain/prompt.js';
import { pageExamples } from '../src/domain/material.js';

test('只有实际接口或寄存器材料加入数字时序指令', () => {
  const guide = (text) => materialGuidance({ sources: [{ text }] });
  assert.match(guide('VALID and READY are sampled at the rising edge of the clock.'), /计数起点/u);
  assert.match(guide('This register contains a W1C field.'), /信号名/u);
  assert.equal(
    guide('The RC trial was registered. Confidence intervals quantify uncertainty.'),
    '',
  );
  assert.equal(guide('Fixed effects regression cannot remove time-varying confounding.'), '');
  assert.equal(guide('The authors reject the argument about a moral right to privacy.'), '');
  assert.equal(guide('Choose an orthonormal basis and diagonalize the covariance matrix.'), '');
  assert.match(pageExamples('Fig. 3 | Course of pain levels')[0], /这张图/u);
  assert.match(pageExamples('Table 3. Regression coefficients')[0], /这张表/u);
  assert.match(pageExamples('We discuss Fig. 3 in the next section.')[0], /这一页/u);
});
