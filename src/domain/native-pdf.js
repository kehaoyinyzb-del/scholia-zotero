import { extractPage } from './pdf-layout.js';
import { mergeTableRows } from './table-layout.js';

function union(rectangles) {
  return [
    Math.min(...rectangles.map((rectangle) => rectangle[0])),
    Math.min(...rectangles.map((rectangle) => rectangle[1])),
    Math.max(...rectangles.map((rectangle) => rectangle[2])),
    Math.max(...rectangles.map((rectangle) => rectangle[3])),
  ];
}

/** Consume Zotero 10's getPageData chars. Keep soft line breaks inside their native paragraph. */
export function extractNativePage(characters, pageIndex, width, printedPage, left = 0) {
  const fragments = [];
  let text = '';
  let rectangles = [];
  let paragraphIndex = 0;
  const finishLine = () => {
    if (!text.trim() || !rectangles.length) return;
    const rectangle = union(rectangles);
    fragments.push({
      str: text.trim(),
      transform: [1, 0, 0, 1, rectangle[0], rectangle[1]],
      width: rectangle[2] - rectangle[0],
      height: rectangle[3] - rectangle[1],
      paragraphIndex,
    });
    text = '';
    rectangles = [];
  };
  for (const character of characters) {
    if (character.ignorable) continue;
    const rectangle = character.inlineRect || character.rect;
    if (rectangle?.length === 4) {
      const previous = rectangles.at(-1);
      if (previous && rectangle[0] - previous[2] >= 12) finishLine();
      rectangles.push(rectangle);
    }
    text += character.c || '';
    if (character.spaceAfter) text += ' ';
    if (character.lineBreakAfter || character.paragraphBreakAfter) finishLine();
    if (character.paragraphBreakAfter) paragraphIndex += 1;
  }
  finishLine();
  const extracted = extractPage(fragments, pageIndex, width, printedPage, left);
  const paragraphs = [];
  for (const line of extracted.paragraphs) {
    const previous = paragraphs.at(-1);
    const rectangle = union(line.position.rects);
    const priorRectangle = previous ? union(previous.position.rects) : null;
    const gap = priorRectangle ? priorRectangle[1] - rectangle[3] : Infinity;
    const height = rectangle[3] - rectangle[1];
    const source = fragments.find((fragment) => fragment.str === line.text);
    const softBreak = previous && !/[.!?。！？:：]$/u.test(previous.text);
    const sameParagraph = source && previous?.nativeParagraph === source.paragraphIndex;
    const prose = previous && !line.text.includes(' | ') && !previous.text.includes(' | ');
    const aligned = priorRectangle && Math.abs(rectangle[0] - priorRectangle[0]) < 20;
    if (prose && aligned && gap >= -2 && gap <= height * 1.2 && (sameParagraph || softBreak)) {
      previous.text += ` ${line.text}`;
      previous.position.rects.push(...line.position.rects);
    } else {
      paragraphs.push({ ...line, nativeParagraph: source?.paragraphIndex });
    }
  }
  const merged = mergeTableRows(paragraphs);
  return {
    ...extracted,
    paragraphs: merged.map(({ nativeParagraph: _nativeParagraph, ...paragraph }, index) => ({
      ...paragraph,
      id: `p${pageIndex + 1}-${index}`,
    })),
    text: merged.map((paragraph) => paragraph.text).join('\n'),
    layoutWarning: '按原生字符、段落标记及坐标排序。复杂跨栏表格与跨页断句需结合图像核对。',
  };
}
