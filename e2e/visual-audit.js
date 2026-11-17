function rgba(value) {
  if (/^color\(srgb /u.test(value)) {
    const values = value.match(/[\d.]+/gu).map(Number);
    return [...values.slice(0, 3).map((value) => value * 255), values[3] ?? 1];
  }
  if (!/^rgba?\(/u.test(value)) return null;
  const values = value.match(/[\d.]+/gu).map(Number);
  return [...values.slice(0, 3), values[3] ?? 1];
}

function over(color, background) {
  return color
    .slice(0, 3)
    .map((value, index) => value * color[3] + background[index] * (1 - color[3]));
}

function luminance(color) {
  return color
    .map((value) => value / 255)
    .map((value) => {
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(window, node, pseudo = null) {
  const layers = [];
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
    const color = rgba(window.getComputedStyle(ancestor).backgroundColor);
    if (color) layers.unshift(color);
    if (color?.[3] === 1) break;
  }
  const style = window.getComputedStyle(node, pseudo);
  const foreground = rgba(style.color);
  const opaque = layers[0]?.[3] === 1;
  let ratio = null;
  if (foreground && opaque) {
    const background = layers.reduce((result, color) => over(color, result), [0, 0, 0]);
    const levels = [luminance(over(foreground, background)), luminance(background)].sort(
      (a, b) => a - b,
    );
    ratio = (levels[1] + 0.05) / (levels[0] + 0.05);
  }
  return {
    color: style.color,
    backgroundLayers: layers,
    contrast: ratio,
    font: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
  };
}

export function auditStyles(window, panel) {
  const samples = [
    ['body', panel],
    ['basis', panel.querySelector('.rc-fixed')],
    ['primary', panel.querySelector('.rc-primary')],
    ['input', panel.querySelector('textarea')],
    ['label', panel.querySelector('label')],
  ];
  const result = {};
  for (const [name, node] of samples) {
    if (node && !node.disabled) result[name] = contrast(window, node);
  }
  const input = panel.querySelector('textarea');
  if (input) result.placeholder = contrast(window, input, '::placeholder');
  return result;
}
