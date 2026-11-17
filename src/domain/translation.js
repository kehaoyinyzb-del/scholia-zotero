import { checkTermConsistency } from './term-consistency.js';

const numericPattern = /[-+−]?\d+(?:[.,]\d+)*(?:[eE][-+]?\d+)?/gu;
const units = '[fpnumkMG]?Hz|[fpnumkM]?[VAsW]|ns|ps|ms|[numk]?m|dB|eV|Pa|K';
const unitPattern = new RegExp(String.raw`(?<![\p{L}_])(?:${units})(?![\p{L}\p{N}_])|[%℃Ωμ]`, 'gu');
const modalityRules = [
  { name: 'shall not', source: /\bshall\s+not\b/iu, target: /不得|禁止|必须不/u },
  { name: 'should not', source: /\bshould\s+not\b/iu, target: /不应|不宜|建议不/u },
  { name: 'shall', source: /\bshall\b(?!\s+not)/iu, target: /必须|应当|须/u },
  { name: 'should', source: /\bshould\b(?!\s+not)/iu, target: /应该|应|建议|宜/u },
  { name: 'may', source: /\bmay\b/iu, target: /可以|允许|可能|可/u },
];

function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) || 0) + 1);
  return result;
}

function missingTokens(original, translated, pattern) {
  const expected = counts(original.match(pattern) || []);
  const actual = counts(translated.match(pattern) || []);
  return [...expected].filter(([token, count]) => (actual.get(token) || 0) < count);
}

function normalizeCitationNumbers(text) {
  return text.replace(
    /(\b\d{4}\s*[:：]\s*|\bpp?\.\s*)(\d+)\s*[–-]\s*(\d+)/giu,
    (_match, prefix, first, last) => {
      if (last.length >= first.length) return `${prefix}${first}–${last}`;
      const modulus = 10 ** last.length;
      let end = Math.floor(Number(first) / modulus) * modulus + Number(last);
      if (end < Number(first)) end += modulus;
      return `${prefix}${first}–${end}`;
    },
  );
}

function paragraphIssues(source, translation) {
  const issues = [];
  if (!translation?.trim()) return ['本段缺少译文。'];
  const missingNumbers = missingTokens(
    normalizeCitationNumbers(source),
    normalizeCitationNumbers(translation),
    numericPattern,
  );
  if (missingNumbers.length) {
    issues.push(`请核对数值 ${missingNumbers.map(([token]) => token).join('、')}。`);
  }
  const missingUnits = missingTokens(source, translation, unitPattern);
  if (missingUnits.length) {
    issues.push(`请核对单位 ${missingUnits.map(([token]) => token).join('、')}。`);
  }
  if (
    /\b(?:not|cannot|never|no|neither|without)\b/iu.test(source) &&
    !/不|无|未|非|禁止|不得/u.test(translation)
  ) {
    issues.push('原文含否定词，译文未识别到对应否定表达。');
  }
  if (/\b(?:unless|except|only if|provided that)\b/iu.test(source)) {
    if (!/除非|除|仅|只有|前提|条件|只在/u.test(translation)) {
      issues.push('请核对例外或生效条件是否保留。');
    }
  }
  for (const rule of modalityRules) {
    if (rule.source.test(source) && !rule.target.test(translation)) {
      issues.push(`请核对 ${rule.name} 的规范强度。`);
    }
  }
  if (
    /\bmay\b/iu.test(source) &&
    /必须|应当|不得/u.test(translation) &&
    !/\b(?:shall|must|should)\b/iu.test(source)
  ) {
    issues.push('原文的 may 可能被加强为强制要求。');
  }
  if (
    /\bshould\b/iu.test(source) &&
    /必须|不得/u.test(translation) &&
    !/\b(?:shall|must)\b/iu.test(source)
  ) {
    issues.push('原文的 should 可能被加强为强制要求。');
  }
  return issues;
}

/** Deterministic warnings complement human review, rather than certify semantic equivalence. */
export function validateTranslation(targets, translations, glossary = [], termHistory = []) {
  const globalIssues = [];
  const expectedIds = new Set(targets.map((paragraph) => paragraph.id));
  const receivedIds = translations.map((paragraph) => paragraph.id);
  if (translations.length !== targets.length) globalIssues.push('原文与译文段数不一致。');
  if (new Set(receivedIds).size !== receivedIds.length) globalIssues.push('译文包含重复段落。');
  if (receivedIds.some((identifier) => !expectedIds.has(identifier))) {
    globalIssues.push('译文包含未发送的段落标识。');
  }
  const rows = targets.map((target) => {
    const translated = translations.find((paragraph) => paragraph.id === target.id);
    const issues = paragraphIssues(target.text, translated?.translation || '');
    if (translated?.original !== target.text) issues.push('返回原文与发送原文不一致。');
    return {
      id: target.id,
      original: target.text,
      role: target.role,
      translation: translated?.translation || '',
      pageIndex: target.pageIndex,
      issues,
      terms: (Array.isArray(translated?.terms) ? translated.terms : [])
        .filter((term) => {
          return (
            term &&
            typeof term.source === 'string' &&
            typeof term.translation === 'string' &&
            target.text.toLowerCase().includes(term.source.toLowerCase()) &&
            translated.translation.includes(term.translation)
          );
        })
        .map((term) => ({
          source: term.source,
          translation: term.translation,
          context: typeof term.context === 'string' ? term.context : '',
        })),
    };
  });
  checkTermConsistency(rows, glossary, termHistory);
  return {
    state:
      globalIssues.length || rows.some((row) => row.issues.length) ? 'needs-review' : 'complete',
    globalIssues,
    rows,
  };
}
