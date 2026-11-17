import { providerSignature } from './configuration.js';

export const normalizeText = (text = '') => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();

export function fingerprint(text) {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function relevantGlossary(glossary, text) {
  const content = normalizeText(text).toLocaleLowerCase();
  return glossary.filter((term) =>
    content.includes(normalizeText(term.source).toLocaleLowerCase()),
  );
}

export function glossaryStamp(glossary, text) {
  return JSON.stringify(relevantGlossary(glossary, text));
}

export function cacheIdentity({ source, context = '', pageIndex, provider, language, glossary }) {
  return {
    source: normalizeText(source),
    context: normalizeText(context),
    pageIndex,
    provider: providerSignature(provider),
    language,
    glossary: glossaryStamp(glossary, source + ' ' + context),
  };
}

export function cacheKey(identity) {
  return fingerprint(JSON.stringify(identity));
}

export function matchingEntry(entries, identity) {
  const entry = entries[cacheKey(identity)];
  // A compact hash locates a candidate; the full identity comparison rejects collisions.
  return entry && !entry.stale && JSON.stringify(entry.identity) === JSON.stringify(identity)
    ? entry
    : null;
}
