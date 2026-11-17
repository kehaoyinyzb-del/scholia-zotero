export function geometryFromBox(box, source) {
  if (!box || box.length !== 4 || !Array.from(box).every(Number.isFinite)) return null;
  const [left, bottom, right, top] = box;
  if (right <= left || top <= bottom) return null;
  return { left, bottom, right, top, width: right - left, height: top - bottom, source };
}

export function geometryFromCharacters(characters) {
  const rectangles = characters
    .map((character) => character.inlineRect || character.rect)
    .filter((rectangle) => geometryFromBox(rectangle, 'character'));
  if (!rectangles.length) return null;
  return geometryFromBox(
    [
      Math.min(...rectangles.map((rectangle) => rectangle[0])),
      Math.min(...rectangles.map((rectangle) => rectangle[1])),
      Math.max(...rectangles.map((rectangle) => rectangle[2])),
      Math.max(...rectangles.map((rectangle) => rectangle[3])),
    ],
    'text-bounds',
  );
}
