export function estimatedTokens(text) {
  const ascii = text.match(/\p{ASCII}/gu)?.length || 0;
  return Math.ceil(ascii / 3 + (text.length - ascii) * 2);
}

export function summarySources(pages) {
  return pages
    .filter((page) => page.text.trim())
    .map((page) => ({
      ...page,
      id: `page-${page.pageIndex + 1}`,
      truncated: false,
    }));
}

export function summaryChunks(sources, budget) {
  const chunks = [];
  let chunk = [],
    size = 0;
  for (const source of sources) {
    for (const paragraph of source.paragraphs) {
      // Split exceptionally long OCR paragraphs without dropping their text.
      for (
        let offset = 0;
        offset < paragraph.text.length;
        offset += Math.max(1, Math.floor(budget / 2))
      ) {
        const text = paragraph.text.slice(offset, offset + Math.max(1, Math.floor(budget / 2)));
        const cost = estimatedTokens(text);
        if (size + cost > budget && chunk.length) {
          chunks.push(chunk);
          chunk = [];
          size = 0;
        }
        let page = chunk.find((entry) => entry.id === source.id);
        if (!page) {
          page = { ...source, paragraphs: [], text: '' };
          chunk.push(page);
        }
        page.paragraphs.push({ ...paragraph, text });
        page.text += text + '\n';
        size += cost;
      }
    }
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function pageRanges(indexes) {
  const values = [...new Set(indexes)].sort((a, b) => a - b);
  const ranges = [];
  for (let index = 0; index < values.length; index++) {
    const start = values[index];
    let end = start;
    while (values[index + 1] === end + 1) end = values[++index];
    ranges.push(start === end ? String(start + 1) : `${start + 1}–${end + 1}`);
  }
  return ranges.join('、');
}

const backMatter = /^(参考文献|references?|bibliography|致谢|acknowledg(e)?ments?)$/iu;
const namedHeading = new RegExp(
  '^(摘要|引言|绪论|背景|相关工作|方法|材料与方法|实验|结果|讨论|结论|附录|' +
    'abstract|introduction|background|related work|methods?|materials and methods|' +
    'experiments?|results?|discussion|conclusions?|appendix|references|bibliography|' +
    'acknowledg(e)?ments?)$',
  'iu',
);
const numberedHeading =
  /^(\d{1,2}(?:\.\d{1,2})?|[一二三四五六七八九十]{1,3}|第[一二三四五六七八九十\d]{1,3}[章节部分])[\s.、]\s*(.+)$/u;

function headingTitle(line) {
  const text = line.trim();
  if (!text || text.length > 60) return null;
  // Running headers and footers ("23 Page 2 of 5", "8 / 18") repeat on every page.
  if (/\bpage\s+\d+\s*(of|\/)\s*\d+|^\d+\s*\/\s*\d+$|©|\bdoi\b/iu.test(text)) return null;
  if (namedHeading.test(text) || backMatter.test(text)) return text;
  const match = numberedHeading.exec(text);
  if (!match) return null;
  const title = match[2].trim();
  // A numbered line that reads like a sentence (commas, full stops, lowercase start) is body text.
  if (!/^[\p{Lu}\p{Lo}]/u.test(title) || /[,;，；。]|\.\s|\.$/u.test(title)) return null;
  if (!/[一-鿿]/u.test(title) && title.split(/\s+/u).length > 6) return null;
  return text;
}

function outlineStarts(outline, count) {
  const entries = outline.filter(
    (entry) => Number.isInteger(entry.index) && entry.index >= 0 && entry.index < count,
  );
  if (!entries.length) return null;
  const top = Math.min(...entries.map((entry) => entry.depth));
  const level = entries
    .filter((entry) => entry.depth === top)
    .sort((a, b) => a.index - b.index)
    .filter((entry, index, all) => index === 0 || entry.index !== all[index - 1].index);
  if (level.length < 2) return null;
  return level.map((entry) => {
    const title = String(entry.title || '').trim() || '未命名';
    return { index: entry.index, title, back: backMatter.test(title) };
  });
}

function headingStarts(pages) {
  const starts = [];
  const seen = new Set();
  for (const page of pages) {
    for (const paragraph of page.paragraphs || []) {
      const title = headingTitle(paragraph.text);
      if (!title || seen.has(title)) continue;
      seen.add(title);
      const back = backMatter.test(title);
      starts.push({ index: page.pageIndex, title, back });
      // Reference lists are full of numbered lines; nothing after them is a chapter.
      if (back) return starts.length > 3 ? starts : null;
      if (starts.length > 30) return null;
    }
  }
  return starts.length >= 3 ? starts : null;
}

function segmentStarts(count) {
  const size = Math.max(3, Math.ceil(count / 8));
  return Array.from({ length: Math.ceil(count / size) }, (_, group) => ({
    index: group * size,
    title: null,
    back: false,
  }));
  // Page groups carry no chapter names; callers decide whether to use them.
}

/**
 * Splits a document into reading sections: PDF outline first, then headings found in the
 * text, then fixed page groups. Reference lists and acknowledgements never become sections.
 */
export function chapterSections(pages, outline = []) {
  const count = pages.length;
  if (!count) return [];
  const starts = outlineStarts(outline, count) || headingStarts(pages) || segmentStarts(count);
  if (starts[0].index > 0) starts.unshift({ index: 0, title: '开篇', back: false });
  const sections = [];
  starts.forEach((start, position) => {
    if (start.back) return;
    const end = starts[position + 1]?.index ?? count;
    const indexes = Array.from({ length: end - start.index }, (_, offset) => start.index + offset);
    if (!indexes.length) return;
    sections.push({
      title: start.title ?? `第 ${pageRanges(indexes)} 页`,
      pages: indexes,
      named: start.title != null,
    });
  });
  return sections;
}

export const summaryInstruction = [
  '按总分总写全文总结，篇幅随章节数伸缩，不设固定要点数，不设总字数上限。',
  '“总”：开头两三句，说明这篇文章研究什么问题、怎么做、核心结论。',
  '“分”：若提供 chapters，按其顺序逐章各写一个 claim，title 原样填章节名（如“引言”“方法”“3. 实验”），',
  'text 两到四句讲这一章说了什么、关键论点或数据，约 80–150 个中文字。',
  '没有 chapters 时，按原文自身的章节结构分段（如引言、方法、结果、讨论，或作者论证的几个部分），title 用原文的章节名，不要用页码范围或页眉文字作标题。',
  '实验研究讲问题、方法、关键数据与限制；人文讲作者论证并区分被反驳观点；理论讲核心命题与前提；规范手册讲对象与重要约束；综述讲覆盖范围与作者判断。',
  '方法写清干预及对照或核心技术，主要结果优先报告主要终点的组间数值和区间。',
  '参考文献、致谢不单列；附录有实质内容时在相应处一句带过。',
  '“总”：结尾两三句，说明全文的贡献、局限和值得注意之处。',
  '开头和结尾两段不设 title。“分”的每章至少给出一处逐字原文出处，原文事实带页码即可，不要求每句都有。',
  '总结只概括原文，不补充背景知识，kind 不使用 background；忠实概括原文时 kind 使用 text，只有你额外作出的判断使用 inference。',
  '局限写研究自身的前提和证据边界；已有文字结果时不因未发送图像而省略结果。',
  'uncertainties 只列影响核心结论的具体缺口。原文文字已有结果时，不添加泛泛的未收到图像提示。',
  '另加 followups 数组，提供两到三个可以接着问的具体短问题。',
  '各页摘录是中间阅读笔记，不能当成原文引用。信息有缺口时明确指出。',
].join('\n');
