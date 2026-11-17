export function pageExamples(text = '') {
  if (/(?:^|\n)\s*(?:Fig(?:ure)?\.?|图)\s*\d+\s*[.:：|/—–]/imu.test(text))
    return ['这张图在说明什么？', '图里哪些是直接可见的，哪些是推导？', '读这张图需要哪些上下文？'];
  if (/(?:^|\n)\s*(?:Table|表)\s*\d+\s*[.:：|/—–]/imu.test(text))
    return ['这张表最重要的比较是什么？', '数值差异能支持什么结论？', '表下注释有哪些限定条件？'];
  return ['这一页在讲什么？', '总结全文', '翻译这一页'];
}
