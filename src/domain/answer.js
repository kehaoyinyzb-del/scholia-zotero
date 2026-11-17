import { uniqueTables } from './answer-layout.js';
import { resolveCitation } from './evidence.js';
import { ReadingError } from './errors.js';
import { validateTranslation } from './translation.js';

export function parseAnswer(raw, snapshot, translationRequired = false) {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/giu, '').trim();
  let result;
  try {
    result = JSON.parse(text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''));
  } catch {
    throw new ReadingError('protocol');
  }
  if (!result || typeof result.answer !== 'string') throw new ReadingError('protocol');
  const seenTables = new Set();
  const claims = (Array.isArray(result.claims) ? result.claims : []).flatMap((claim) => {
    if (
      !claim ||
      typeof claim.text !== 'string' ||
      !['visual', 'text', 'inference', 'background'].includes(claim.kind)
    ) {
      return [];
    }
    const claimText = uniqueTables(claim.text, seenTables);
    if (!claimText) return [];
    return [
      {
        text: claimText,
        ...(typeof claim.title === 'string' ? { title: claim.title.slice(0, 48) } : {}),
        kind: claim.kind,
        citations: (Array.isArray(claim.citations) ? claim.citations : [])
          .map((citation) => resolveCitation(snapshot, citation))
          .filter(Boolean)
          .filter(
            (entry, index, all) =>
              all.findIndex(
                (other) => other.pageIndex === entry.pageIndex && other.quote === entry.quote,
              ) === index,
          )
          .slice(0, 2),
      },
    ];
  });
  const translations = (Array.isArray(result.translations) ? result.translations : []).filter(
    (entry) =>
      entry &&
      typeof entry.id === 'string' &&
      typeof entry.original === 'string' &&
      typeof entry.translation === 'string',
  );
  const translation = translationRequired
    ? validateTranslation(
        snapshot.translationTargets,
        translations,
        snapshot.glossary,
        snapshot.termHistory,
      )
    : null;
  if (
    translation &&
    snapshot.sources.some((source) => {
      return source.pageIndex === snapshot.pageIndex && source.truncated;
    })
  ) {
    translation.globalIssues.push('当前页原文超出本轮预算，译文覆盖不完整。请分组选区翻译。');
    translation.state = 'needs-review';
  }
  return {
    text: uniqueTables(result.answer),
    claims,
    followups: (Array.isArray(result.followups) ? result.followups : [])
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .slice(0, 3),
    translation,
    coverage: typeof result.coverage === 'string' ? result.coverage : '',
    uncertainties: (Array.isArray(result.uncertainties) ? result.uncertainties : []).filter(
      (entry) => typeof entry === 'string',
    ),
    state: translation?.state === 'needs-review' ? 'needs-review' : 'complete',
  };
}

/** Only answer text is previewed. Reasoning channels never reach this parser. */
export function streamingAnswerPreview(raw) {
  const match = raw.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/u);
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return '';
  }
}
