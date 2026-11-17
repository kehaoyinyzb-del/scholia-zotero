const stopWords = new Set(
  (
    'the and that this with from have were been are was for not but ' +
    'into these those their they which what when where also than then our you can may will ' +
    'der die das den dem des und ein eine einer einen einem eines ist sind mit von zum zur ' +
    'auf für sich als werden wird nicht oder auch durch nach bei über'
  ).split(' '),
);

const concepts = [
  [/假设|识别/u, ['assumption', 'identification', 'exogeneity']],
  [/局限|限制|不足/u, ['limitation', 'limit', 'bias']],
  [/混杂/u, ['confounding', 'confounder', 'time-varying']],
  [/反向因果/u, ['reverse causality', 'endogeneity']],
  [/因果/u, ['causal', 'causality']],
  [/固定效应/u, ['fixed effects', 'within-person']],
  [/置信区间/u, ['confidence interval', 'bootstrapping']],
  [/效应量/u, ['effect size', 'cohen']],
  [/样本|人群/u, ['sample', 'participants', 'population']],
  [/随机|对照/u, ['randomised', 'randomized', 'control']],
  [/定义/u, ['definition', 'defined']],
  [/法律权利/u, ['legal right', 'legal rights']],
  [/道德权利|道德隐私权/u, ['moral right', 'moral rights']],
  [/反驳|论点/u, ['argument', 'objection', 'mistaken']],
  [/方差/u, ['variance']],
  [/正交/u, ['orthogonal', 'orthonormal']],
  [/转置/u, ['transpose', 'transposed']],
  [/推导|定理/u, ['derivation', 'theorem', 'proof']],
  [/义务/u, ['obligation', 'verpflichtung']],
  [/尊严/u, ['dignity', 'würde']],
  [/立法|行政|司法/u, ['gesetzgebung', 'vollziehende', 'rechtsprechung']],
];

function terms(text) {
  const matches = text.toLowerCase().match(/[\p{L}][\p{L}\p{N}_]{2,}/gu) || [];
  return [...new Set(matches.filter((term) => !stopWords.has(term)))];
}

export function retrieveSources(pages, capture, question, wholeDocument = false, budget = 32000) {
  const anchor = pages.find((page) => page.pageIndex === capture.pageIndex);
  const questionTerms = new Set([
    ...terms(`${question} ${capture.selection?.text || ''}`),
    ...concepts.filter(([pattern]) => pattern.test(question)).flatMap(([, values]) => values),
  ]);
  const query = [...new Set([...questionTerms, ...terms(anchor?.text || '')])];
  const texts = pages.map((page) => page.text.toLowerCase());
  const rarity = new Map(
    query.map((term) => [
      term,
      Math.log(1 + pages.length / (1 + texts.filter((text) => text.includes(term)).length)),
    ]),
  );
  const requiredIndexes = new Set([capture.pageIndex, ...(capture.selection?.pageIndexes || [])]);
  const primary = pages.filter((page) => requiredIndexes.has(page.pageIndex));
  const candidates = pages.filter((page) => !requiredIndexes.has(page.pageIndex));
  const ranked = candidates.map((page) => ({
    page,
    score: query.reduce(
      (score, term) =>
        score +
        Number(page.text.toLowerCase().includes(term)) *
          rarity.get(term) *
          (questionTerms.has(term) ? 12 : 1),
      0,
    ),
  }));
  ranked.sort(
    (left, right) => right.score - left.score || left.page.pageIndex - right.page.pageIndex,
  );
  const context = wholeDocument
    ? candidates
    : ranked
        .filter((entry) => entry.score > 0)
        .slice(0, 5)
        .map((entry) => entry.page);
  let remaining = budget;
  return [...primary, ...context].flatMap((page) => {
    const paragraphs = [];
    for (const paragraph of page.paragraphs) {
      if (paragraph.text.length > remaining) break;
      paragraphs.push(paragraph);
      remaining -= paragraph.text.length;
    }
    if (!paragraphs.length) return [];
    return [
      {
        id: `page-${page.pageIndex + 1}`,
        pageIndex: page.pageIndex,
        printedPage: page.printedPage,
        paragraphs,
        text: paragraphs.map((paragraph) => paragraph.text).join('\n'),
        truncated: paragraphs.length !== page.paragraphs.length,
        layoutWarning: page.layoutWarning || null,
        geometry: page.geometry || null,
      },
    ];
  });
}
