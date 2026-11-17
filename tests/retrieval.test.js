import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveSources } from '../src/domain/retrieval.js';

test('中文识别假设与局限问题能找回英文方法页，而不是只重复表格邻页', () => {
  const texts = Array.from(
    { length: 18 },
    () =>
      'The and this table describes fixed effects regression coefficients and perceived stress.',
  );
  texts[9] = 'Table 3. Fixed effects regression coefficients for perceived stress.';
  texts[5] = 'Identification assumptions: no time-varying confounding, no reverse causality.';
  texts[12] = 'Limitations include selection bias and omitted time-varying confounders.';
  const pages = texts.map((text, pageIndex) => ({
    pageIndex,
    text,
    paragraphs: [{ id: `p-${pageIndex}`, text }],
  }));
  const result = retrieveSources(
    pages,
    { pageIndex: 9 },
    '为什么固定效应仍依赖识别假设？有哪些混杂、反向因果和局限？',
  );
  assert.equal(result[0].pageIndex, 9);
  assert.deepEqual(new Set(result.slice(1, 3).map((page) => page.pageIndex)), new Set([5, 12]));
  assert(result.every((source) => source.text === pages[source.pageIndex].text));
});
