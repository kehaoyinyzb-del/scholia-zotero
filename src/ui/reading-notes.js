import { element, action } from './dom.js';
import { collapsibleText } from './collapsible.js';

export class ReadingNotesPanel {
  constructor(panel) {
    this.panel = panel;
    this.service = panel.application.readingNotes;
    this.observer = panel.application.environment.Zotero.Notifier.registerObserver(
      {
        notify: () => {
          if (this.active && !this.editing) this.refresh();
        },
      },
      ['item'],
      'reading-companion-note-list',
    );
  }

  async open() {
    this.panel.notebook.close();
    this.close();
    this.active = true;
    this.panel.root.classList.add('rc-notes-active');
    this.panel.notesButton.setAttribute('aria-pressed', 'true');
    this.panel.notesButton.setAttribute('aria-label', '返回对话');
    this.panel.notesButton.title = '返回对话';
    const document = this.panel.document;
    this.root = element(document, 'section', null, { class: 'rc-reading-notes' });
    this.search = element(document, 'input', null, {
      type: 'search',
      placeholder: '搜索划线和笔记',
      'aria-label': '搜索划线和笔记',
    });
    this.search.addEventListener('input', () => this.render());
    this.list = element(document, 'div', null, { class: 'rc-note-list' });
    this.feedback = element(document, 'p', '', { role: 'status' });
    const footer = element(document, 'div', null, { class: 'rc-notes-footer' });
    footer.append(
      action(
        document,
        '整理成一篇笔记',
        () => {
          this.close();
          this.panel.notebook.open('annotations');
        },
        { class: 'rc-primary' },
      ),
      action(
        document,
        '导出',
        () =>
          this.guard(async () => {
            const id = await this.service.export(this.panel.activeReader.itemID);
            this.panel.document.defaultView.ZoteroPane.openNoteWindow(id);
          }),
        { class: 'rc-button', title: '导出划线和笔记为一篇子笔记' },
      ),
    );
    this.root.append(this.search, this.list, this.feedback, footer);
    this.panel.conversation.before(this.root);
    await this.refresh();
  }

  async guard(operation) {
    try {
      await operation();
    } catch (error) {
      if (this.active) this.feedback.textContent = error.message;
    }
  }

  async refresh() {
    if (!this.active || this.editing) return;
    const revision = (this.revision = (this.revision || 0) + 1);
    const itemID = this.panel.activeReader.itemID;
    await this.guard(async () => {
      const entries = await this.service.list(itemID);
      if (!this.active || revision !== this.revision || itemID !== this.panel.activeReader.itemID)
        return;
      this.entries = entries;
      this.render();
    });
  }

  render() {
    if (!this.active || this.editing) return;
    const document = this.panel.document;
    const query = this.search.value.trim().toLocaleLowerCase();
    this.list.replaceChildren();
    const entries = (this.entries || []).filter((entry) =>
      (entry.text + '\n' + entry.comment).toLocaleLowerCase().includes(query),
    );
    if (!entries.length)
      this.list.append(
        element(
          document,
          'p',
          query
            ? '没有找到匹配的笔记。'
            : '还没有划线。在 PDF 里选中一段文字，点“记笔记”写下自己的话。',
        ),
      );
    for (const entry of entries) {
      const row = element(document, 'article', null, {
        class: 'rc-reading-note',
        'data-note-id': entry.id,
      });
      if (entry.text)
        row.append(
          collapsibleText(document, entry.text, 'rc-note-excerpt', 3, () =>
            this.guard(() => this.navigate(entry)),
          ),
        );
      const comment = element(document, 'p', entry.comment, { class: 'rc-note-comment' });
      row.append(comment);
      const controls = element(document, 'div', null, { class: 'rc-turn-actions' });
      if (entry.position)
        controls.append(
          action(document, `p.${entry.position.pageIndex + 1}`, () =>
            this.guard(() => this.navigate(entry)),
          ),
        );
      else controls.append(element(document, 'small', '未挂原文位置'));
      controls.append(
        action(document, '编辑', () => this.edit(entry, row)),
        action(document, '删除', () =>
          this.guard(async () => {
            const accepted = this.panel.application.environment.Services.prompt.confirm(
              document.defaultView,
              '删除这条笔记',
              entry.annotation
                ? '将同时删除 PDF 上的这条划线及评论。确定删除吗？'
                : '删除这条笔记。可以从 Zotero 回收站恢复。',
            );
            if (accepted) {
              await this.service.remove(entry);
              await this.refresh();
            }
          }),
        ),
        action(document, '针对这条提问', () =>
          this.guard(async () => {
            this.close();
            this.panel.addReference({
              text: entry.text || entry.comment,
              kind: entry.text ? 'original' : 'answer',
              pageIndex: entry.position?.pageIndex ?? this.panel.viewState.pageIndex,
              position: entry.position || null,
            });
            this.panel.input.focus();
          }),
        ),
      );
      row.append(controls);
      this.list.append(row);
    }
  }

  async navigate(entry) {
    await this.panel.activeReader.navigate({ annotationID: entry.key });
    await this.panel.activeReader.navigate({ position: entry.position });
  }

  edit(entry, row) {
    if (this.editing) return;
    this.editing = true;
    const document = this.panel.document;
    const input = element(document, 'textarea', null, { rows: '4', 'aria-label': '编辑笔记' });
    input.value = entry.comment;
    const finish = () => {
      this.editing = false;
      this.refresh();
    };
    const save = action(document, '保存', () =>
      this.guard(async () => {
        save.disabled = true;
        try {
          await this.service.update(entry, input.value);
          finish();
        } finally {
          save.disabled = false;
        }
      }),
    );
    save.className = 'rc-primary';
    const buttons = element(document, 'div', null, { class: 'rc-note-edit-actions' });
    buttons.append(action(document, '取消', finish, { class: 'rc-button' }), save);
    row.replaceChildren(input, buttons);
    input.focus();
  }

  close() {
    this.active = false;
    this.editing = false;
    this.revision = (this.revision || 0) + 1;
    this.root?.remove();
    this.panel.root.classList.remove('rc-notes-active');
    if (this.panel.notesButton) {
      this.panel.notesButton.setAttribute('aria-pressed', 'false');
      this.panel.notesButton.setAttribute('aria-label', '笔记');
      this.panel.notesButton.title = '这篇文献的划线和笔记';
    }
  }

  destroy() {
    this.close();
    this.panel.application.environment.Zotero.Notifier.unregisterObserver(this.observer);
  }
}
