/** Keep geometric positions so citations can use Zotero's temporary position highlight. */
export function extractPage(items, pageIndex, width, printedPage = null, left = 0) {
  const baselines = new Map();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const baseline = Math.round(item.transform[5] / 3) * 3;
    const height = Math.abs(item.height || item.transform[3] || 10);
    const cell = {
      text: item.str,
      left: item.transform[4],
      right: item.transform[4] + item.width,
      rectangle: [item.transform[4], baseline, item.transform[4] + item.width, baseline + height],
    };
    if (!baselines.has(baseline)) baselines.set(baseline, []);
    baselines.get(baseline).push(cell);
  }
  const lines = [...baselines]
    .sort((first, second) => second[0] - first[0])
    .map(([baseline, cells]) => ({
      baseline,
      cells: cells.sort((first, second) => first.left - second.left),
    }));
  const gaps = [];
  for (const line of lines) {
    for (let index = 1; index < line.cells.length; index++) {
      const before = line.cells[index - 1],
        after = line.cells[index];
      const center = (before.right + after.left) / 2;
      if (
        after.left - before.right >= 12 &&
        before.text.length > 24 &&
        after.text.length > 24 &&
        center > left + width * 0.25 &&
        center < left + width * 0.75
      )
        gaps.push({ center, baseline: line.baseline });
    }
  }
  const candidates = gaps
    .map((gap) => ({
      center: gap.center,
      count: new Set(
        gaps
          .filter((other) => Math.abs(other.center - gap.center) < 12)
          .map((other) => other.baseline),
      ).size,
    }))
    .sort((a, b) => b.count - a.count);
  // Columns can have different baseline spacing, especially beside figures and tables.
  const prose = lines
    .flatMap((line) => line.cells)
    .filter((cell) => cell.text.length > 35 && cell.right - cell.left > width * 0.23);
  const columnEdges = prose
    .filter((cell) => cell.left > left + width * 0.25 && cell.left < left + width * 0.75)
    .map((cell) => {
      const center = cell.left - 8;
      const leftCount = prose.filter((entry) => entry.right < center).length;
      const rightCount = prose.filter((entry) => entry.left > center).length;
      const crossing = prose.length - leftCount - rightCount;
      return {
        center,
        score: leftCount + rightCount - crossing * 4,
        valid: leftCount >= 8 && rightCount >= 8 && crossing < prose.length * 0.25,
      };
    })
    .filter((entry) => entry.valid)
    .sort((a, b) => b.score - a.score);
  const middle = columnEdges[0]?.center || candidates[0]?.center || left + width / 2;
  const twoColumns =
    columnEdges.length > 0 ||
    (candidates[0]?.count >= 8 && candidates[0].count > lines.length * 0.3);
  const ordered = [];
  let leftColumn = [];
  let rightColumn = [];
  const flushColumns = () => {
    ordered.push(...leftColumn, ...rightColumn);
    leftColumn = [];
    rightColumn = [];
  };
  for (const line of lines) {
    const crossesGutter = line.cells.some((cell) => cell.left < middle && cell.right > middle);
    if (!twoColumns || crossesGutter) {
      flushColumns();
      ordered.push(line);
    } else {
      const left = line.cells.filter((cell) => cell.left < middle);
      const right = line.cells.filter((cell) => cell.left >= middle);
      if (left.length) leftColumn.push({ ...line, cells: left });
      if (right.length) rightColumn.push({ ...line, cells: right });
    }
  }
  flushColumns();
  const paragraphs = ordered.map((line, index) => ({
    id: `p${pageIndex + 1}-${index}`,
    pageIndex,
    text: line.cells
      .map((cell, cellIndex) => {
        const preceding = line.cells[cellIndex - 1];
        const separator = preceding && cell.left - preceding.right > 20 ? ' | ' : ' ';
        return (cellIndex ? separator : '') + cell.text;
      })
      .join(''),
    position: { pageIndex, rects: line.cells.map((cell) => cell.rectangle) },
  }));
  return {
    pageIndex,
    printedPage,
    paragraphs,
    text: paragraphs.map((paragraph) => paragraph.text).join('\n'),
    noText: !paragraphs.length,
    layoutWarning: twoColumns
      ? '按左右栏坐标排序。多栏表格与跨页断句仍需结合图像核对。'
      : '按坐标提取文本行。段落与表格结构需结合图像核对。',
  };
}
