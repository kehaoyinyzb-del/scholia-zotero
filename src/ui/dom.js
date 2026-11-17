export function element(document, tag, text, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
  if (text !== null && text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  return node;
}

export function action(document, label, handler, attributes = {}) {
  const button = element(document, 'button', label, { type: 'button', ...attributes });
  button.addEventListener('click', handler);
  return button;
}

export function labeledControl(document, label, control) {
  const wrapper = element(document, 'label', null, { class: 'rc-field' });
  const text = element(document, 'span', label);
  if (control.type === 'checkbox') {
    wrapper.classList.add('rc-checkbox-field');
    wrapper.append(control, text);
  } else if (control.localName === 'select') {
    const shell = element(document, 'span', null, { class: 'rc-select-shell' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'aria-hidden': 'true',
    }))
      svg.setAttribute(key, value);
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M4 6l4 4 4-4');
    svg.append(path);
    shell.append(control, svg);
    wrapper.append(text, shell);
  } else wrapper.append(text, control);
  return wrapper;
}
