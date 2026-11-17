import { element } from '../ui/dom.js';
import { ReadingPanel } from '../ui/panel.js';

/** A reversible sibling of Zotero's item/notes context; never replace native deck indexes. */
export class ReaderWorkspace {
  constructor(window, application) {
    this.window = window;
    this.application = application;
    const document = window.document;
    this.host = document.getElementById('zotero-context-pane');
    this.native = [...this.host.children].map((node) => ({ node, hidden: node.hidden }));
    this.root = element(document, 'section', null, {
      class: 'rc-workspace',
      'aria-label': 'Scholia',
    });
    this.body = element(document, 'div', null, { class: 'rc-workspace-body' });
    this.root.append(this.body);
    this.host.append(this.root);
    this.panel = new ReadingPanel(document, this.body, application, () => this.hide());
    application.panels.set(this.body, this.panel);
    this.show();
  }

  show() {
    this.window.ZoteroContextPane.collapsed = false;
    for (const { node } of this.native) node.hidden = true;
    this.root.hidden = false;
    this.host.classList.add('rc-workspace-active');
    this.panel
      ?.refresh()
      .catch((error) => this.application.recordFailure(error, 'workspace-refresh'));
  }

  hide() {
    this.root.hidden = true;
    this.host.classList.remove('rc-workspace-active');
    for (const { node, hidden } of this.native) node.hidden = hidden;
  }

  destroy() {
    this.hide();
    this.panel.destroy();
    this.application.panels.delete(this.body);
    this.root.remove();
  }
}
