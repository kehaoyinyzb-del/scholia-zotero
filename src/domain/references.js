import { clone } from './immutable.js';

export function addReference(references, reference) {
  const next = clone(reference);
  if (!next.text?.trim()) throw new Error('请先选中要引用的文字。');
  if (references.some((entry) => entry.text === next.text && entry.pageIndex === next.pageIndex))
    return references;
  const remaining = 8000 - references.reduce((count, entry) => count + entry.text.length, 0);
  if (references.length >= 5 || remaining <= 0)
    throw new Error('一次最多引用 5 段、共 8000 字。请先移除一段或发送。');
  if (next.text.length > remaining) {
    next.originalLength = next.text.length;
    next.text = next.text.slice(0, remaining);
    if (/[\uD800-\uDBFF]$/u.test(next.text)) next.text = next.text.slice(0, -1);
    next.position = null;
  }
  return [...references, next];
}

export function referenceSources(references) {
  return references
    .filter((entry) => entry.kind !== 'answer')
    .map((entry, index) => ({
      id: `quote-${index + 1}`,
      pageIndex: entry.pageIndex,
      printedPage: null,
      text: entry.text,
      truncated: Boolean(entry.originalLength),
      paragraphs: [
        {
          id: `quote-${index + 1}`,
          text: entry.text,
          pageIndex: entry.pageIndex,
          position: entry.position || null,
        },
      ],
    }));
}
