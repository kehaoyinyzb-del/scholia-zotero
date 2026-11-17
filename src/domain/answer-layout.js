// Deduplicate Markdown tables by cells, ignoring formatting and separator widths.
export function uniqueTables(text, seen = new Set()) {
  const lines = text.split('\n');
  const result = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('|') && /^\s*\|?\s*:?-{3,}/u.test(lines[index + 1] || '')) {
      const table = [lines[index], lines[++index]];
      while (index + 1 < lines.length && lines[index + 1].includes('|')) table.push(lines[++index]);
      const key = JSON.stringify(
        table
          .filter((_, row) => row !== 1)
          .map((row) =>
            row
              .replace(/^\s*\||\|\s*$/gu, '')
              .split('|')
              .map((cell) => cell.trim()),
          ),
      );
      if (!seen.has(key)) result.push(...table);
      seen.add(key);
    } else result.push(lines[index]);
  }
  return result.join('\n').trim();
}
