import { action } from './dom.js';

// One family: 16 px grid, 1.5 px round strokes, glyphs kept inside a 2.5–13.5 box so
// every icon has the same optical size. Dots and the stop square are filled shapes.
const paths = {
  plus: 'M8 3.5v9M3.5 8h9',
  history: 'M3.4 5.1A5.25 5.25 0 1 1 2.75 8M3.25 2.6v2.65H5.9M8 5.25V8l1.9 1.25',
  notes: [
    'M4.5 2.75h6.25a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4.5z',
    'M4.5 2.75v10.5',
    'M6.75 5.75h2.75',
    'M6.75 8.25h2.75',
  ],
  chat: [
    'M3 4.25a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5' +
      'H7.25L4.5 13v-2.25A1.5 1.5 0 0 1 3 9.25z',
  ],
  copy: 'M6 5.75h6.25v6.75H6zM10 5.75v-2.5H3.75V10H6',
  bookmark: 'M4.75 2.75h6.5v10.5L8 11l-3.25 2.25z',
  refresh: 'M12.75 8a4.75 4.75 0 1 1-1.4-3.37M12.75 2.75v2.5h-2.5',
  send: 'M8 12.75v-9.5M4.25 7 8 3.25 11.75 7',
  close: 'M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5',
  down: 'M4.75 6.5 8 9.75l3.25-3.25',
  right: 'M6.5 4.75 9.75 8 6.5 11.25',
  check: 'M3.75 8.5 6.6 11.25 12.25 5',
  page: 'M4.25 2.75h4.75l2.75 2.75v7.75H4.25zM9 2.75V5.5h2.75',
  lock: 'M5.25 7V5.5a2.75 2.75 0 0 1 5.5 0V7M4.25 7h7.5v6.25h-7.5z',
  quotation: [
    'M3.25 7.75h2.9v3.5h-2.9z',
    'M3.25 7.75c0-2.1.75-3.4 2.4-4.25',
    'M9.75 7.75h2.9v3.5h-2.9z',
    'M9.75 7.75c0-2.1.75-3.4 2.4-4.25',
  ],
  sparkle: 'M8 2.75l1.3 3.95 3.95 1.3-3.95 1.3L8 13.25 6.7 9.3 2.75 8l3.95-1.3z',
  explain: [
    'M6.25 12.25h3.5',
    'M6.75 13.75h2.5',
    'M8 2.5a3.75 3.75 0 0 0-2.25 6.75c.45.35.75.85.75 1.4' +
      'v.1h3v-.1c0-.55.3-1.05.75-1.4A3.75 3.75 0 0 0 8 2.5z',
  ],
  translate: [
    'M2.75 3.75h6',
    'M5.75 2.5v1.25',
    'M3.75 3.75c.4 2 1.7 3.6 3.75 4.6',
    'M7.75 3.75c-.5 2.15-2 3.9-4.5 4.9',
    'M8.75 13.5 11 7.75l2.25 5.75',
    'M9.5 11.75h3',
  ],
  summary: 'M3.25 4h9.5M3.25 8h9.5M3.25 12h5.5',
  search: 'M7.25 2.75a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.6 10.6l2.65 2.65',
  trash: 'M3 4.5h10M6.25 4.5V3h3.5v1.5M4.5 4.5l.6 8.75h5.8l.6-8.75',
  edit: 'M10.25 3 13 5.75 6.25 12.5 3 13l.5-3.25z',
  back: 'M12.5 8h-9M7 4.5 3.5 8 7 11.5',
  arrow: 'M3.5 8h9M9 4.5 12.5 8 9 11.5',
  book: 'M3.25 3.75a1 1 0 0 1 1-1h8.5v9h-8.5a1 1 0 0 0-1 1zM3.25 12.75a1 1 0 0 0 1 1h8.5',
  sliders: 'M3 5h5.5M11.5 5H13M3 11h1.5M7.5 11H13M10 3.5v3M6 9.5v3',
  account: [
    'M8 2.75a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    'M3.25 13.25c.6-2.3 2.4-3.5 4.75-3.5s4.15 1.2 4.75 3.5',
  ],
  key: [
    'M10 2.75a3.25 3.25 0 1 1-2.95 4.6L2.75 11.6v1.65H4.5' +
      'v-1.5H6V10.3l1.35-1.35A3.25 3.25 0 0 1 10 2.75z',
    'M10.6 5.4h.01',
  ],
  export: 'M8 9.75V2.75M5 5.5 8 2.5l3 3M3.25 9v3.25a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V9',
  warning: 'M8 2.75 13.5 12.5h-11zM8 6.5v2.75M8 10.9h.01',
  external: [
    'M9.25 2.75h4v4',
    'M13.25 2.75 7.75 8.25',
    'M11.25 9.5v3a.75.75 0 0 1-.75.75h-6.75a.75.75 0 0 1-.75-.75V5.5a.75.75 0 0 1 .75-.75h3',
  ],
  // Older names kept so callers outside src/ui do not break.
  quote: [
    'M3 4.25a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5' +
      'H7.25L4.5 13v-2.25A1.5 1.5 0 0 1 3 9.25z',
  ],
};

const filled = {
  more: [
    ['circle', { cx: 3.75, cy: 8, r: 1.1 }],
    ['circle', { cx: 8, cy: 8, r: 1.1 }],
    ['circle', { cx: 12.25, cy: 8, r: 1.1 }],
  ],
  stop: [['rect', { x: 4.75, y: 4.75, width: 6.5, height: 6.5, rx: 1.25 }]],
};

export function icon(document, name) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: 'rc-icon',
    'data-icon': name,
  }))
    svg.setAttribute(key, String(value));
  if (filled[name]) {
    for (const [tag, attributes] of filled[name]) {
      const shape = document.createElementNS(namespace, tag);
      for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
      shape.setAttribute('fill', 'currentColor');
      shape.setAttribute('stroke', 'none');
      svg.append(shape);
    }
    return svg;
  }
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', [paths[name] || paths.chat].flat().join(''));
  svg.append(path);
  return svg;
}

export function iconAction(document, label, name, handler, attributes = {}) {
  const button = action(document, '', handler, {
    class: 'rc-icon-button',
    'aria-label': label,
    title: label,
    ...attributes,
  });
  button.append(icon(document, name));
  return button;
}

/** A text button with a leading icon; the label stays the accessible name. */
export function labeledAction(document, label, name, handler, attributes = {}) {
  const button = action(document, '', handler, attributes);
  button.append(icon(document, name), document.createTextNode(label));
  return button;
}
