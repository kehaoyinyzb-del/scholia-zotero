/** Keep a rectangular run together so translations cannot detach a field from its column. */
export function mergeTableRows(paragraphs) {
  const result = [];
  let index = 0;
  while (index < paragraphs.length) {
    const first = paragraphs[index];
    const cells = first.text.split(' | ');
    const rows = [first];
    if (cells.length > 1) {
      while (index + rows.length < paragraphs.length) {
        const next = paragraphs[index + rows.length];
        if (next.text.split(' | ').length !== cells.length) break;
        rows.push(next);
      }
    }
    if (rows.length > 1) {
      const lines = rows.map((row) => `| ${row.text} |`);
      lines.splice(1, 0, `| ${cells.map(() => '---').join(' | ')} |`);
      result.push({
        ...first,
        text: lines.join('\n'),
        kind: 'table',
        columns: cells.length,
        rowCount: rows.length,
        position: { pageIndex: first.pageIndex, rects: rows.flatMap((row) => row.position.rects) },
      });
    } else {
      result.push(first);
    }
    index += rows.length;
  }
  return result;
}
