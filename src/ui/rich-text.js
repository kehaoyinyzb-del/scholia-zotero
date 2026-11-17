import katex from 'katex';
import { element } from './dom.js';

// Han, kana and Hangul; CJK punctuation is deliberately excluded because it already
// carries its own side bearing.
const cjk =
  '\\u2E80-\\u2FFF\\u3040-\\u30FF\\u31F0-\\u31FF\\u3400-\\u4DBF' +
  '\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF';
const latinStart = 'A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF$@#(\\[';
const latinEnd = 'A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF%)\\]°';
const units =
  'mg|μg|µg|kg|g|mL|ml|μL|µL|L|mmol|μmol|mol|nm|μm|µm|mm|cm|km|ms|μs|µs|ns|min|h|' +
  'Hz|kHz|MHz|GHz|mV|kV|V|mA|μA|µA|W|kW|mW|dB|Ω|kΩ|MΩ|KB|kB|MB|GB|TB|bit|bps';
// Curly quotes are left out: many CJK faces draw them proportional, not full width.
const closingPunctuation = '，。、；：！？）」』》〉】〕';
const fullwidthPunctuation = closingPunctuation + '（「『《〈【〔';

/**
 * Pure typesetting for model prose: space between CJK and Latin/digits, digits and
 * SI units, preserving numeric range characters. Returns runs so callers can mark glyphs that
 * must come from the CJK face (quotes, dashes) or lose half their advance (collisions).
 */
const spacing = [
  [new RegExp(`([${cjk}])(?=[${latinStart}])`, 'gu'), '$1 '],
  [new RegExp(`([${latinEnd}])(?=[${cjk}])`, 'gu'), '$1 '],
  [
    new RegExp(`(^|[^A-Za-z0-9_.])(\\d+(?:\\.\\d+)?)(?=(?:${units})(?![A-Za-z]))`, 'gu'),
    '$1$2\u00A0',
  ],
  // A value never wraps away from its unit.
  [new RegExp(`(\\d) (?=(?:${units})(?![A-Za-z]))`, 'gu'), '$1\u00A0'],
];

export function typesetText(text) {
  return spacing.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}

export function typesetRuns(text) {
  const spaced = typesetText(text);
  const runs = [];
  const push = (value, kind = 'text') => {
    if (!value) return;
    const last = runs.at(-1);
    if (kind === 'text' && last?.kind === 'text') last.text += value;
    else runs.push({ text: value, kind });
  };
  const cjkNear = new RegExp(`[${cjk}${fullwidthPunctuation}]`, 'u');
  const glyphs = /(“|”|‘|’|—{1,2}|…{1,2}|·)/u;
  const range = /\d+(?:\.\d+)?%?–\d+(?:\.\d+)?%?/y;
  for (let index = 0; index < spaced.length; index += 1) {
    const character = spaced[index];
    range.lastIndex = index;
    const numeric = !/[\d.]/u.test(spaced[index - 1] || '') && range.exec(spaced);
    if (numeric) {
      // Ranges such as 1.2–4.3 stay on one line.
      push(numeric[0], 'nowrap');
      index += numeric[0].length - 1;
      continue;
    }
    const next = spaced[index + 1] || '';
    if (closingPunctuation.includes(character) && next && fullwidthPunctuation.includes(next)) {
      push(character, 'half');
      continue;
    }
    if (glyphs.test(character)) {
      const before = spaced[index - 1] || '';
      let end = index + 1;
      while (end < spaced.length && spaced[end] === character && end - index < 2) end += 1;
      const after = spaced[end] || '';
      const value = spaced.slice(index, end);
      if (cjkNear.test(before) || cjkNear.test(after)) push(value, 'cjk');
      else push(value);
      index = end - 1;
      continue;
    }
    push(character);
  }
  return runs;
}

function appendTypeset(document, parent, text, typeset = true) {
  if (!typeset) {
    parent.append(document.createTextNode(text));
    return;
  }
  for (const run of typesetRuns(text)) {
    if (run.kind === 'text') parent.append(document.createTextNode(run.text));
    else
      parent.append(
        element(document, 'span', run.text, {
          class: { half: 'rc-punct-half', cjk: 'rc-cjk-glyph', nowrap: 'rc-nowrap' }[run.kind],
        }),
      );
  }
}

export function appendProse(document, parent, text) {
  appendTypeset(document, parent, text);
}

function appendPlain(document, parent, text, typeset) {
  // Only shapes that cannot be ordinary acronyms become code: digits, underscores,
  // bit ranges or hex. "RCT" or "PCA" stay in the reading face.
  const identifiers = new RegExp(
    '\\b(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z][A-Z0-9_]*\\[\\d+(?::\\d+)?\\]|0x[\\dA-Fa-f]+)' +
      '(?![A-Za-z0-9_])',
    'gu',
  );
  if (typeset) text = typesetText(text);
  let offset = 0;
  for (const match of text.matchAll(identifiers)) {
    appendTypeset(document, parent, text.slice(offset, match.index), typeset);
    parent.append(element(document, 'code', match[0]));
    offset = match.index + match[0].length;
  }
  appendTypeset(document, parent, text.slice(offset), typeset);
}

const cjkEdge = new RegExp(`[${cjk}]`, 'u');

// Inline tokens (formulas, code, bold) split the text, so spacing at their edges is
// decided here, using the token's visible first and last characters.
function edgeSpacing(parts) {
  const visible = (part, end) => {
    if (part.type === 'plain') return end ? part.text.at(-1) : part.text[0];
    if (part.text.startsWith('**')) return end ? part.text.at(-3) : part.text[2];
    return 'x';
  };
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.type !== 'plain' || !part.text) continue;
    const previous = parts[index - 1];
    const next = parts[index + 1];
    if (previous && previous.type !== 'plain') {
      const left = visible(previous, true) || '';
      if (cjkEdge.test(part.text[0]) && /[A-Za-z0-9%)\]]/u.test(left)) part.text = ' ' + part.text;
      else if (/[A-Za-z0-9(]/u.test(part.text[0]) && cjkEdge.test(left))
        part.text = ' ' + part.text;
    }
    if (next && next.type !== 'plain') {
      const right = visible(next, false) || '';
      if (cjkEdge.test(part.text.at(-1)) && /[A-Za-z0-9(]/u.test(right)) part.text += ' ';
      else if (/[A-Za-z0-9%)]/u.test(part.text.at(-1)) && cjkEdge.test(right)) part.text += ' ';
    }
  }
  return parts;
}

export function alignEquation(expression) {
  if (expression.length < 40 || /\\begin\{|\\\\/u.test(expression)) return expression;
  const parts = [];
  let depth = 0;
  let offset = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (character === '{' && expression[index - 1] !== '\\') depth += 1;
    if (character === '}' && expression[index - 1] !== '\\') depth -= 1;
    if (character === '=' && depth === 0) {
      parts.push(expression.slice(offset, index));
      offset = index + 1;
    }
  }
  if (parts.length < 2) return expression;
  parts.push(expression.slice(offset));
  return `\\begin{aligned}${parts[0]} &= ${parts.slice(1).join(' \\\\ &= ')}\\end{aligned}`;
}

function appendToken(document, parent, token, typeset) {
  if (/^https?:\/\//u.test(token)) {
    parent.append(document.createTextNode(token));
  } else if (token.startsWith('**')) {
    const strong = element(document, 'strong');
    appendInline(document, strong, token.slice(2, -2), typeset);
    parent.append(strong);
  } else if (token.startsWith('`')) {
    parent.append(element(document, 'code', token.slice(1, -1)));
  } else {
    const displayMode = token.startsWith('$$');
    const delimiter = displayMode || token.startsWith('\\(') ? 2 : 1;
    const expression = token.slice(delimiter, -delimiter);
    const formula = element(document, 'span', null, { class: 'rc-formula' });
    try {
      // KaTeX creates MathML from an expression. Raw model HTML never reaches innerHTML.
      formula.innerHTML = katex.renderToString(
        displayMode && typeset ? alignEquation(expression) : expression,
        {
          throwOnError: true,
          trust: false,
          strict: 'error',
          output: 'mathml',
          displayMode,
          maxExpand: 500,
        },
      );
    } catch {
      formula.textContent = '公式无法解析，请回看原文。';
      formula.setAttribute('role', 'note');
    }
    parent.append(formula);
  }
}

function appendInline(document, parent, text, typeset) {
  const pattern =
    /(https?:\/\/[^\s<>]+|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+\$|`[^`]+`|\*\*[^*]+\*\*)/gu;
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push({ type: 'plain', text: text.slice(offset, match.index) });
    parts.push({ type: 'token', text: match[0] });
    offset = match.index + match[0].length;
  }
  parts.push({ type: 'plain', text: text.slice(offset) });
  for (const part of typeset ? edgeSpacing(parts) : parts) {
    if (part.type === 'plain') appendPlain(document, parent, part.text, typeset);
    else appendToken(document, parent, part.text, typeset);
  }
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\||\|$/gu, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function renderRichText(document, text, { typeset = true } = {}) {
  const root = element(document, 'div', null, { class: 'rc-prose' });
  const lines = text
    .replace(/\\\[([\s\S]*?)\\\]/gu, (_match, formula) => {
      return `$$${formula.replace(/\n/gu, ' ')}$$`;
    })
    .split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index++]);
      }
      const preformatted = element(document, 'pre');
      preformatted.append(element(document, 'code', codeLines.join('\n')));
      root.append(preformatted);
    } else if (line.includes('|') && /^\s*\|?\s*:?-{3,}/u.test(lines[index + 1] || '')) {
      const viewport = element(document, 'div', null, {
        class: 'rc-table-scroll',
        tabindex: '0',
        'aria-label': '可横向滚动的表格',
      });
      const table = element(document, 'table');
      const header = element(document, 'thead');
      const headerRow = element(document, 'tr');
      for (const value of tableCells(line)) {
        const cell = element(document, 'th', null, { scope: 'col' });
        appendInline(document, cell, value, typeset);
        headerRow.append(cell);
      }
      header.append(headerRow);
      table.append(header);
      const body = element(document, 'tbody');
      index += 2;
      while (index < lines.length && lines[index].includes('|')) {
        const row = element(document, 'tr');
        for (const value of tableCells(lines[index])) {
          const cell = element(document, 'td');
          appendInline(document, cell, value, typeset);
          row.append(cell);
        }
        body.append(row);
        index += 1;
      }
      index -= 1;
      table.append(body);
      const rows = [...body.rows];
      for (const [column, cell] of [...headerRow.cells].entries()) {
        const compact = rows.every((row) => {
          const value = row.cells[column]?.textContent || '';
          return value.length <= 12 && !/[。；，：]|\s[^\d]/u.test(value);
        });
        if (compact) {
          cell.classList.add('rc-table-compact');
          for (const row of rows) row.cells[column]?.classList.add('rc-table-compact');
        }
      }
      viewport.append(table);
      root.append(viewport);
    } else if (line.trim()) {
      const heading = /^#{1,6}\s+(.+)/u.exec(line);
      const paragraph = element(document, heading ? 'h4' : 'p');
      appendInline(
        document,
        paragraph,
        heading ? heading[1] : line.replace(/^[-*]\s+/u, ''),
        typeset,
      );
      root.append(paragraph);
    }
    index += 1;
  }
  return root;
}

export function renderTableTranslation(document, original, translated) {
  const source = renderRichText(document, original);
  const target = renderRichText(document, translated);
  const sourceTable = source.querySelector('table');
  const targetTable = target.querySelector('table');
  if (
    source.childElementCount !== 1 ||
    target.childElementCount !== 1 ||
    !sourceTable ||
    !targetTable ||
    sourceTable.rows.length !== targetTable.rows.length
  )
    return null;
  for (const [index, row] of [...sourceTable.rows].entries()) {
    if (row.cells.length !== targetTable.rows[index].cells.length) return null;
  }
  for (const [index, row] of [...sourceTable.rows].entries()) {
    for (const [column, cell] of [...row.cells].entries()) {
      const translatedCell = targetTable.rows[index].cells[column];
      if (cell.textContent.trim() === translatedCell.textContent.trim()) continue;
      if (index === 0) {
        translatedCell.title = cell.textContent;
        continue;
      }
      const originalCell = element(document, 'small', null, { class: 'rc-table-original' });
      while (cell.firstChild) originalCell.append(cell.firstChild);
      translatedCell.append(originalCell);
    }
  }
  target.classList.add('rc-bilingual-table');
  return target;
}
