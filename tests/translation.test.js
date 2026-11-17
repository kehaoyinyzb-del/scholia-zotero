import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTranslation } from '../src/domain/translation.js';
import { parseAnswer, streamingAnswerPreview } from '../src/domain/answer.js';
import { snapshot } from './helpers.js';

function validate(original, translation) {
  const paragraph = { id: 'p1-0', text: original, pageIndex: 0 };
  return validateTranslation([paragraph], [{ id: 'p1-0', original, translation }]);
}

test('完整保留数值、单位、否定与 shall 的译文通过确定性检查', () => {
  const result = validate('DATA shall not change for 3 ns.', 'DATA 在 3 ns 内不得变化。');
  assert.equal(result.state, 'complete');
});

test('引文缩写页码 115–6 与展开页码等价，普通算式不会被当作页码改写', () => {
  assert.equal(
    validate('He argues otherwise (2021: 115–6).', '他提出了不同论点（2021: 115–116）。').state,
    'complete',
  );
  assert.equal(validate('See pp. 199–203.', '见 pp. 199–203。').state, 'complete');
  assert.equal(validate('The difference is 115-6.', '差值为 115-116。').state, 'needs-review');
});

test('Unicode 单词 Würde 不被当作 W，真实数值旁的单位仍受校验', () => {
  assert.equal(
    validate('Die Würde des Menschen ist unantastbar.', '人的尊严不可侵犯。').state,
    'complete',
  );
  assert(
    validate('The measured delay is 3ns.', '测得延迟为 3。').rows[0].issues.some((issue) =>
      issue.includes('ns'),
    ),
  );
  assert(
    validate('Power is 3 W.', '功率为 3。').rows[0].issues.some((issue) => issue.includes('W')),
  );
});

test('遗漏数值、单位和否定标到具体段落', () => {
  const result = validate('DATA shall not change for 3 ns.', 'DATA 变化。');
  assert.equal(result.state, 'needs-review');
  assert.ok(result.rows[0].issues.some((issue) => issue.includes('3')));
  assert.ok(result.rows[0].issues.some((issue) => issue.includes('ns')));
  assert.ok(result.rows[0].issues.some((issue) => issue.includes('否定')));
  assert.ok(result.rows[0].issues.some((issue) => issue.includes('shall not')));
});

test('may 和 should 加强为必须会标记', () => {
  for (const modal of ['may', 'should']) {
    const result = validate(`Source ${modal} change DATA.`, '发送端必须改变 DATA。');
    assert.equal(result.state, 'needs-review');
    assert.ok(result.rows[0].issues.some((issue) => issue.includes('加强')));
  }
});

test('缺段、重复段、额外段与原文被模型修改可见', () => {
  const targets = [
    { id: 'a', text: 'One.', pageIndex: 0 },
    { id: 'b', text: 'Two.', pageIndex: 0 },
  ];
  const result = validateTranslation(targets, [
    { id: 'a', original: 'Changed.', translation: '一。' },
    { id: 'a', original: 'One.', translation: '一。' },
    { id: 'extra', original: 'Extra.', translation: '额外。' },
  ]);
  assert.equal(result.globalIssues.length, 3);
  assert.ok(result.rows[0].issues.some((issue) => issue.includes('不一致')));
  assert.ok(result.rows[1].issues.some((issue) => issue.includes('缺少')));
});

test('例外条件丢失与部分流式 JSON 不能被当成完成', () => {
  assert.equal(
    validate('Only if READY=1, DATA may change.', 'READY=1，DATA 可以改变。').state,
    'needs-review',
  );
  assert.throws(() => parseAnswer('{"answer":"partial', snapshot()), /protocol/u);
});

test('预算截断当前页时，即使返回段数匹配，也不能显示完整翻译完成', () => {
  const evidence = structuredClone(snapshot());
  evidence.sources.find((source) => source.pageIndex === evidence.pageIndex).truncated = true;
  const answer = parseAnswer(JSON.stringify({ answer: '解释', translations: [] }), evidence, true);
  assert.equal(answer.state, 'needs-review');
  assert.ok(answer.translation.globalIssues.some((issue) => issue.includes('覆盖不完整')));
});

test('思考字段与思考标签不会混入译文；流式预览只读取 answer', () => {
  const result = parseAnswer('<think>private reasoning</think>{"answer":"解释"}', snapshot());
  assert.equal(result.text, '解释');
  assert.equal(streamingAnswerPreview('{"reasoning":"hidden","answer":"你好'), '你好');
  assert.equal(streamingAnswerPreview('{"reasoning":"hidden'), '');
});
