export function sameAnnotationPosition(first, second) {
  const round = (rects) => rects?.map((rect) => rect.map((value) => Math.round(value * 1000)));
  return (
    first.pageIndex === second.pageIndex &&
    JSON.stringify(round(first.rects)) === JSON.stringify(round(second.rects)) &&
    JSON.stringify(round(first.nextPageRects)) === JSON.stringify(round(second.nextPageRects))
  );
}

// Only a unique, verbatim match can become a new highlight. Paragraph bounds are insufficient.
export function quoteAnnotation(chars, quote, pageIndex, pageHeight = 0) {
  let text = '';
  const owners = [];
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    const value = char.c + (char.spaceAfter || char.lineBreakAfter ? ' ' : '');
    for (const letter of value) {
      if (/\s/u.test(letter) && text.endsWith(' ')) continue;
      text += /\s/u.test(letter) ? ' ' : letter;
      // String.indexOf uses UTF-16 offsets, including two units for mathematical letters.
      for (let unit = 0; unit < letter.length; unit++) owners.push(index);
    }
  }
  const needle = quote.replace(/\s+/gu, ' ').trim();
  const start = text.indexOf(needle);
  if (!needle || start < 0 || text.indexOf(needle, start + 1) >= 0) return null;
  const first = owners[start];
  const last = owners[start + needle.length - 1];
  const rects = [];
  let line;
  for (let index = first; index <= last; index++) {
    const char = chars[index];
    const rect = Array.from(char.inlineRect || char.rect || []);
    if (rect.length !== 4 || !rect.every(Number.isFinite)) return null;
    if (!line) rects.push((line = [...rect]));
    else {
      line[0] = Math.min(line[0], rect[0]);
      line[1] = Math.min(line[1], rect[1]);
      line[2] = Math.max(line[2], rect[2]);
      line[3] = Math.max(line[3], rect[3]);
    }
    if (char.lineBreakAfter || char.paragraphBreakAfter) line = null;
  }
  return {
    text: quote,
    position: { pageIndex, rects },
    sortIndex: [pageIndex, first, Math.floor(Math.max(0, pageHeight - rects[0][3]))]
      .map((value, index) => String(value).padStart(index === 1 ? 6 : 5, '0'))
      .join('|'),
    pageLabel: String(pageIndex + 1),
  };
}
