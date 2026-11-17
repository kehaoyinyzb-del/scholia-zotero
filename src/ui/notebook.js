import { element, action, labeledControl } from './dom.js';
import { renderRichText } from './rich-text.js';
import { errorFeedback } from '../domain/errors.js';
import { sourceReferences } from '../domain/notebook.js';

export class NotebookPanel {
  constructor(panel) {
    this.panel = panel;
  }

  async open(mode = 'annotations') {
    this.close();
    this.panel.notes?.close();
    this.active = true;
    const panel = this.panel;
    this.readingInput = panel.input.value;
    panel.root.classList.add('rc-notebook-active');
    panel.more.hidden = true;
    panel.secondary.hidden = true;
    panel.conversation.hidden = true;
    panel.latest.hidden = true;
    panel.input.value = '';
    panel.input.placeholder = '调整笔记，例如“再简短点”…';
    this.root = element(panel.document, 'section', null, {
      class: 'rc-conversation rc-notebook',
      'aria-label': '整理笔记',
    });
    panel.conversation.before(this.root);
    const scope = element(panel.document, 'input', null, { type: 'checkbox' });
    scope.value = mode;
    this.scope = scope;
    const header = element(panel.document, 'div', null, { class: 'rc-notebook-controls' });
    header.append(
      labeledControl(panel.document, '同时补上我没划到的关键内容', scope),
      action(panel.document, '继续阅读', () => this.close(), { title: '回到对话' }),
    );
    this.coverage = element(panel.document, 'p', '正在读取划线和笔记…', { class: 'rc-muted' });
    this.generate = action(panel.document, '生成笔记', () => this.run(), {
      class: 'rc-primary rc-notebook-generate',
    });
    this.preview = element(panel.document, 'div', null, { class: 'rc-notebook-preview' });
    this.saves = element(panel.document, 'div', null, { class: 'rc-notebook-controls' });
    this.feedback = element(panel.document, 'p', '', { role: 'status' });
    this.root.append(header, this.coverage, this.generate, this.preview, this.saves, this.feedback);
    scope.addEventListener('change', () => this.prepare());
    await this.prepare();
  }

  async prepare() {
    this.controller?.abort();
    const controller = new this.panel.document.defaultView.AbortController();
    this.controller = controller;
    this.prepared = null;
    this.draft = null;
    this.generate.disabled = true;
    this.preview.replaceChildren();
    this.saves.replaceChildren();
    try {
      const prepared = await this.panel.application.notebooks.prepare(
        this.panel.activeReader,
        this.scope.checked ? 'annotations-plus' : 'annotations',
        controller.signal,
      );
      if (!this.active || controller.signal.aborted) return;
      this.prepared = prepared;
      this.coverage.textContent = `将纳入：${prepared.material.coverage}`;
      this.generate.disabled = false;
    } catch (error) {
      this.error(error);
    }
  }

  async run(revision = '') {
    if (!this.prepared || this.busy) return;
    const input = this.panel.input.value;
    const version = this.panel.draftRevision;
    if (revision) this.panel.setDraft('');
    this.busy = true;
    this.generate.disabled = true;
    this.scope.disabled = true;
    this.saves.replaceChildren();
    this.feedback.textContent = '';
    this.feedback.classList.add('rc-stream');
    const controller = new this.panel.document.defaultView.AbortController();
    this.controller = controller;
    try {
      const draft = await this.panel.application.notebooks.generate(
        this.prepared,
        controller.signal,
        revision,
        this.draft,
      );
      if (!this.active || controller.signal.aborted || this.controller !== controller) return;
      this.draft = draft;
      this.render();
    } catch (error) {
      if (this.controller === controller && this.active) {
        if (revision && this.panel.draftRevision === version && !this.panel.input.value)
          this.panel.setDraft(input);
        this.error(error);
      }
    } finally {
      if (this.controller === controller) {
        this.busy = false;
        this.generate.disabled = !this.prepared;
        this.scope.disabled = false;
        this.feedback.classList.remove('rc-stream');
      }
    }
  }

  render() {
    const document = this.panel.document;
    this.preview.replaceChildren(element(document, 'h2', this.draft.title));
    this.coverage.textContent = `覆盖范围：${this.draft.material.coverage}`;
    this.preview.lang = 'zh-CN';
    const sources = new Map(this.draft.material.sources.map((source) => [source.id, source]));
    for (const section of this.draft.sections) {
      this.preview.append(element(document, 'h3', section.title));
      for (const point of section.points) {
        const block = element(document, 'div', null, { class: 'rc-notebook-point' });
        if (point.added || point.kind === 'user')
          block.append(
            element(document, 'span', point.added ? '模型补充' : '我的话', {
              class: 'rc-claim-label',
            }),
          );
        block.append(
          point.kind === 'user'
            ? element(document, 'p', point.text, { style: 'white-space:pre-wrap' })
            : renderRichText(document, point.text),
        );
        const references = element(document, 'div', null, { class: 'rc-notebook-references' });
        const pages = new Map();
        for (const id of point.sources) {
          const source = sources.get(id);
          for (const reference of sourceReferences(source)) {
            const group = pages.get(reference.pageIndex) || [];
            group.push({ ...reference, text: reference.quote || source.text });
            pages.set(reference.pageIndex, group);
          }
        }
        const extra = element(document, 'span', null, { hidden: '' });
        for (const [index, group] of [...pages.values()].entries()) {
          const source = group[0];
          (index < 3 ? references : extra).append(
            action(
              document,
              `第 ${source.pageIndex + 1} 页`,
              () => this.panel.application.reader.navigate(this.prepared.snapshot, source),
              { title: group.map((entry) => entry.text).join('\n'), class: 'rc-text-button' },
            ),
          );
        }
        if (pages.size > 3) {
          const toggle = action(document, `另 ${pages.size - 3} 页`, () => {
            extra.hidden = !extra.hidden;
            toggle.textContent = extra.hidden ? `另 ${pages.size - 3} 页` : '收起';
          });
          references.append(toggle, extra);
        }
        block.append(references);
        this.preview.append(block);
      }
    }
    this.saves.replaceChildren(
      action(document, '新建子笔记', () => this.save('new'), { class: 'rc-primary' }),
    );
    if (this.prepared.session.notebookNoteID)
      this.saves.append(
        action(document, '更新原笔记', () => this.save('update'), { class: 'rc-button' }),
      );
    this.generate.textContent = '重新生成';
    this.generate.className = 'rc-button rc-notebook-generate';
  }

  async save(mode) {
    if (this.saving || !this.draft) return;
    this.saving = true;
    const prepared = this.prepared;
    const draft = this.draft;
    try {
      const id = await this.panel.application.notebooks.save(prepared, draft, mode);
      if (!this.active || this.prepared !== prepared) return;
      this.feedback.textContent = mode === 'update' ? '已更新原笔记。' : '已新建子笔记。';
      this.render();
      this.saves.append(
        action(
          this.panel.document,
          '打开笔记',
          () => {
            this.panel.document.defaultView.ZoteroPane.openNoteWindow(id);
          },
          { class: 'rc-button' },
        ),
      );
    } catch (error) {
      this.error(error);
    } finally {
      this.saving = false;
    }
  }

  error(error) {
    if (!this.active || this.controller?.signal.aborted) return;
    this.panel.application.recordFailure(error, 'notebook');
    const feedback = error.code ? errorFeedback(error) : null;
    this.feedback.textContent = feedback
      ? `${feedback.title}。${feedback.reason}${feedback.action}`
      : error.message;
  }

  cancel() {
    this.controller?.abort();
  }

  close() {
    this.controller?.abort();
    this.root?.remove();
    if (this.active) {
      this.panel.input.value = this.readingInput || '';
      this.panel.resizeInput();
    }
    this.panel.root.classList.remove('rc-notebook-active');
    this.active = false;
    this.busy = false;
    this.panel.conversation.hidden = false;
    this.panel.input.placeholder = '问这一页…';
  }
}
