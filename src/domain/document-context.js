import { normalizeText } from './translation-cache.js';

export function documentOccurrences(pages, selected, limit = 3) {
  const key = normalizeText(selected).toLocaleLowerCase();
  if (!key) return [];
  const results = [];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}_])`,
    'iu',
  );
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const definition = new RegExp(
    `(?:${escaped}\\s+(?:means|is defined as|refers to|denotes)\\b|` +
      `(?:define|defined)\\s+${escaped}\\s+(?:as|to mean)\\b|` +
      `${escaped}[，,:：\\s]*(?:定义为|是指|指的是))`,
    'iu',
  );
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      for (const { segment } of segmenter.segment(paragraph.text)) {
        if (!pattern.test(normalizeText(segment))) continue;
        results.push({
          text: segment.trim(),
          pageIndex: page.pageIndex,
          position: paragraph.position,
          definition: definition.test(normalizeText(segment)),
        });
      }
    }
  }
  return results.sort((a, b) => Number(b.definition) - Number(a.definition)).slice(0, limit);
}

export function selectionContextDetails({
  pages,
  selected,
  context,
  pageIndex,
  position,
  metadata = {},
}) {
  const current = pages.find((page) => page.pageIndex === pageIndex);
  const candidates =
    current?.paragraphs.filter((entry) =>
      normalizeText(entry.text).includes(normalizeText(selected)),
    ) || [];
  const anchor = position?.rects?.[0];
  const distance = (entry) =>
    Math.min(
      ...(entry.position?.rects || []).map((rect) =>
        anchor ? Math.abs(rect[0] - anchor[0]) + Math.abs(rect[1] - anchor[1]) * 4 : 0,
      ),
    );
  const paragraph = candidates.sort((a, b) => distance(a) - distance(b))[0];
  const occurrences = documentOccurrences(pages, selected, 5);
  const nearby =
    current?.paragraphs.slice(0, Math.max(1, current.paragraphs.indexOf(paragraph) + 1)) || [];
  const heading = nearby.findLast((entry) =>
    /^(?:\d+(?:\.\d+)*\s|Fig(?:ure)?\.?\s|Table\s|图\s*\d|表\s*\d)/iu.test(entry.text),
  );
  return {
    sentence: context.slice(0, 1800),
    paragraph: (paragraph?.text || context).slice(0, 2600),
    definitions: occurrences.filter((entry) => entry.definition).slice(0, 2),
    heading: heading?.text.slice(0, 400) || '',
    caption:
      nearby
        .findLast((entry) => /^(?:Fig(?:ure)?\.?|Table|图|表)\s*\d/iu.test(entry.text))
        ?.text.slice(0, 500) || '',
    tableHeader: paragraph?.text.includes('|')
      ? paragraph.text.split('\n').slice(0, 2).join('\n')
      : '',
    metadata,
    occurrences: occurrences.slice(0, 3),
  };
}
