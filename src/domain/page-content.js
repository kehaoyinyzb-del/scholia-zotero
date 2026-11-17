function edge(paragraph, page) {
  if (!page.geometry || page.geometry.source === 'text-bounds' || paragraph.text.length > 180)
    return null;
  const rect = paragraph.position?.rects?.[0];
  if (!rect) return null;
  const relative = (rect[1] - page.geometry.bottom) / page.geometry.height;
  return relative < 0.09 ? 'bottom' : relative > 0.92 ? 'top' : null;
}

export function pageContent(pages, pageIndex) {
  const page = pages.find((entry) => entry.pageIndex === pageIndex);
  if (!page) return [];
  const key = (text) => text.trim().toLowerCase().replace(/\d+/gu, '#').replace(/\s+/gu, ' ');
  return page.paragraphs
    .flatMap((paragraph) => {
      const side = edge(paragraph, page);
      if (side && /^\s*(?:\d+|[ivxlcdm]+)\s*$/iu.test(paragraph.text)) return [];
      if (
        side &&
        pages.some(
          (other) =>
            other !== page &&
            other.paragraphs.some(
              (entry) => edge(entry, other) === side && key(entry.text) === key(paragraph.text),
            ),
        )
      )
        return [];
      const heading =
        paragraph.text.length < 150 &&
        /^(?:\d+(?:\.\d+)*\s+\S|chapter\s+\d|第.+章)/iu.test(paragraph.text);
      return [{ ...paragraph, role: side ? 'marginal' : heading ? 'heading' : 'body' }];
    })
    .sort((a, b) => Number(a.role === 'marginal') - Number(b.role === 'marginal'));
}
