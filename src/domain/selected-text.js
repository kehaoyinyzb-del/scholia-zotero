// Resolve display-only spacing against the original prose. Never persist the DOM's
// NBSPs; matching ignores whitespace but preserves every other character.
export function originalSelection(original, displayed) {
  const positions = [];
  let compact = '';
  for (let index = 0; index < original.length; index++) {
    if (/\s/u.test(original[index])) continue;
    positions.push(index);
    compact += original[index];
  }
  const needle = displayed.replace(/\s/gu, '');
  const start = needle ? compact.indexOf(needle) : -1;
  return start < 0
    ? null
    : original.slice(positions[start], positions[start + needle.length - 1] + 1);
}
