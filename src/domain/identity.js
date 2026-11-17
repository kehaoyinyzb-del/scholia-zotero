export function canonicalURL(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/u.test(name)) url.searchParams.delete(name);
    }
    return url.href;
  } catch {
    return '';
  }
}

export function documentIdentity(item) {
  const url = canonicalURL(item.url || '');
  const arxiv = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/iu);
  if (arxiv) return `arxiv:${arxiv[1]}`;
  const doi = (item.DOI || '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
    .replace(/^doi:\s*/iu, '')
    .toLowerCase();
  if (doi) return `doi:${doi}:${item.version || ''}`;
  return url ? `url:${url}` : null;
}

export function sameDocument(first, second) {
  const identity = documentIdentity(first);
  return Boolean(identity && identity === documentIdentity(second));
}
