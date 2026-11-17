export function correctTerm(glossary, source, translation, context = '') {
  const correction = {
    source: source.trim(),
    translation: translation.trim(),
    context: context.trim(),
  };
  if (!correction.source || !correction.translation) {
    throw new Error('请填写原词和译法。');
  }
  const remaining = glossary.filter((term) => {
    return term.source !== correction.source || term.context !== correction.context;
  });
  return [...remaining, correction];
}
