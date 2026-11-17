const visitCount = /到馆次数|到访次数|访问次数|入馆次数|到访量|访问量|人次/u;
const visitorCount = /人数|访客数|访客人数|到访者|访问者|独立访客/u;

function key(term) {
  return `${term.source.normalize('NFKC').trim().toLowerCase()}\u0000${term.context || ''}`;
}

function equivalent(term, translation) {
  if (/^visits$/iu.test(term.source)) return visitCount.test(translation);
  if (/^(unique )?visitors$/iu.test(term.source)) return visitorCount.test(translation);
  return term.translation === translation;
}

export function checkTermConsistency(rows, glossary = [], history = []) {
  const known = new Map(history.map((term) => [key(term), term]));
  for (const term of glossary) known.set(key(term), { ...term, corrected: true });
  for (const row of rows) {
    if (/\bvisits\b/iu.test(row.original) && !visitCount.test(row.translation)) {
      row.issues.push('请核对 visits 的统计单位，应表达次数或人次，不能替换为人数。');
    }
    if (/\bunique visitors\b/iu.test(row.original) && !visitorCount.test(row.translation)) {
      row.issues.push('请核对 unique visitors 的人数含义，并与 visits 的次数区分。');
    }
    for (const term of row.terms || []) {
      const previous = known.get(key(term));
      if (previous && !equivalent(previous, term.translation)) {
        row.issues.push(
          `${term.source} 在同一语境的译法发生变化：` +
            `“${previous.translation}”与“${term.translation}”，请核对。`,
        );
      } else if (!previous) {
        known.set(key(term), term);
      }
    }
    // Do not rely on the model reporting a changed term in its optional terms list.
    for (const term of known.values()) {
      const sourcePresent = row.original.toLowerCase().includes(term.source.toLowerCase());
      const contextApplies =
        !term.context || row.original.toLowerCase().includes(term.context.toLowerCase());
      const matched = /^(visits|(?:unique )?visitors)$/iu.test(term.source)
        ? equivalent(term, row.translation)
        : row.translation.includes(term.translation);
      if (sourcePresent && contextApplies && !matched) {
        row.issues.push(`本篇 ${term.source} 已使用“${term.translation}”，请核对本段译法。`);
      }
    }
  }
  return rows;
}
