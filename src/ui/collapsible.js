import { element, action } from './dom.js';

export function collapsibleText(document, text, className, lines, navigate) {
  const root = element(document, 'div', null, { class: className + ' rc-collapsible' });
  root.style.setProperty('--rc-lines', lines);
  const body = element(document, 'div', text, { class: 'rc-collapse-text' });
  if (navigate) {
    body.setAttribute('role', 'button');
    body.setAttribute('tabindex', '0');
    body.title = '回到原文';
    body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      navigate();
    });
  }
  const toggle = action(
    document,
    '展开',
    (event) => {
      event.stopPropagation();
      const expanded = root.classList.toggle('rc-expanded');
      toggle.textContent = expanded ? '收起' : '展开';
      toggle.setAttribute('aria-expanded', String(expanded));
    },
    { class: 'rc-collapse-toggle', hidden: '', 'aria-expanded': 'false' },
  );
  if (navigate) root.addEventListener('click', () => navigate());
  root.append(body, toggle);
  document.defaultView.requestAnimationFrame?.(() => {
    if (root.isConnected) toggle.hidden = body.scrollHeight <= body.clientHeight + 1;
  });
  return root;
}
