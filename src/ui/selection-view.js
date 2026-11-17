import { element, action } from './dom.js';
import { iconAction, labeledAction } from './icons.js';
import { appendProse } from './rich-text.js';

export class SelectionView {
  constructor(document, selected, dictionary, identifier) {
    this.document = document;
    this.root = element(document, 'section', null, {
      class: 'rc-popup rc-layered-popup',
      'data-selection-id': identifier,
      'data-kind': dictionary ? 'word' : 'sentence',
      'aria-label': '划词翻译',
      lang: 'zh-CN',
    });
    const header = element(document, 'div', null, { class: 'rc-selection-heading' });
    this.original = element(document, 'span', selected, {
      class: 'rc-selection-original',
      title: selected,
      lang: 'en',
    });
    this.phonetic = element(document, 'span', '', { class: 'rc-selection-phonetic' });
    this.layer = element(document, 'span', '正在精译', { class: 'rc-selection-layer' });
    header.append(this.original, this.phonetic, this.layer);
    this.result = element(document, 'div', '', {
      class: 'rc-selection-result',
      'aria-live': 'polite',
    });
    this.secondary = element(document, 'div', '', { class: 'rc-selection-other' });
    const body = element(document, 'div', null, { class: 'rc-selection-body' });
    body.append(this.result, this.secondary);
    this.controls = element(document, 'div', null, {
      class: 'rc-turn-actions rc-selection-controls',
    });
    this.detail = element(document, 'section', null, { class: 'rc-selection-detail', hidden: '' });
    const scroll = element(document, 'div', null, { class: 'rc-selection-scroll' });
    scroll.append(header, body, this.detail);
    this.root.append(scroll, this.controls);
  }

  show(fields, label, offline) {
    if (this.meaning !== fields.meaning) {
      this.meaning = fields.meaning;
      this.result.replaceChildren();
      appendProse(this.document, this.result, fields.meaning || '');
    }
    this.layer.textContent = label;
    this.root.dataset.layer = label;
    this.root.dataset.ready = String(Boolean(fields.meaning));
    if (offline?.phonetic)
      this.phonetic.textContent =
        (offline.lemma !== this.original.textContent.toLowerCase()
          ? `原形 ${offline.lemma} `
          : '') + `/${offline.phonetic}/`;
    const other = [
      fields.partOfSpeech,
      fields.alternatives || offline?.alternatives,
      fields.context,
    ]
      .filter(Boolean)
      .join(' · ');
    this.secondary.replaceChildren();
    appendProse(this.document, this.secondary, other);
  }

  actions(callbacks, dictionary) {
    const quote = labeledAction(this.document, '引用', 'quotation', callbacks.quote, {
      title: '引用到侧栏提问（Ctrl + Alt + Q）',
      class: 'rc-quote-action',
    });
    const explain = labeledAction(this.document, '讲懂', 'explain', callbacks.follow, {
      title: '引用并讲懂这段',
    });
    this.buttons = [
      ...(dictionary ? [iconAction(this.document, '加入术语表', 'book', callbacks.glossary)] : []),
      iconAction(this.document, '复制译文', 'copy', callbacks.copy),
    ];
    for (const button of this.buttons) button.disabled = true;
    this.buttons[0].classList.add('rc-selection-tools');
    const moreLabel = dictionary ? '更多' : '句子结构';
    const more = iconAction(
      this.document,
      moreLabel,
      'more',
      () => {
        this.detail.hidden = !this.detail.hidden;
        more.setAttribute('aria-expanded', String(!this.detail.hidden));
        if (!this.detail.hidden) callbacks.more(this.detail);
      },
      {
        class: 'rc-icon-button rc-selection-more',
        'aria-expanded': 'false',
        title: dictionary ? '本文定义和其他出现' : '拆解句子结构',
      },
    );
    const note = labeledAction(this.document, '记笔记', 'edit', () =>
      this.editNote(callbacks.note),
    );
    note.title = '划线并写下自己的话';
    this.controls.append(
      quote,
      ...(callbacks.note ? [note] : []),
      ...(dictionary ? [] : [explain]),
      ...this.buttons,
      more,
    );
  }

  editNote(save) {
    if (this.editor) {
      this.editor.focus();
      return;
    }
    const container = element(this.document, 'div', null, { class: 'rc-note-editor' });
    const input = element(this.document, 'textarea', null, {
      placeholder: '写下自己的话，也可以直接保存划线',
      'aria-label': '我的笔记',
      rows: '3',
    });
    this.editor = input;
    const status = element(this.document, 'p', '', { role: 'status' });
    let saving = false;
    const close = () => {
      container.remove();
      this.editor = null;
    };
    const commit = async () => {
      if (saving) return;
      saving = true;
      button.disabled = true;
      try {
        await save(input.value);
        container.replaceChildren(element(this.document, 'p', '已保存'));
      } catch (error) {
        status.textContent = error.message;
        saving = false;
        button.disabled = false;
      }
    };
    const button = action(this.document, '保存', commit);
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!saving) close();
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        commit();
      }
    });
    button.className = 'rc-primary';
    const row = element(this.document, 'div', null, { class: 'rc-note-editor-actions' });
    row.append(
      status,
      action(
        this.document,
        '取消',
        () => {
          if (!saving) close();
        },
        { class: 'rc-button' },
      ),
      button,
    );
    container.append(input, row);
    this.root.querySelector('.rc-selection-scroll').append(container);
    input.focus();
    input.scrollIntoView?.({ block: 'nearest' });
  }

  complete() {
    this.root.dataset.complete = 'true';
    for (const button of this.buttons || []) button.disabled = false;
    this.result.classList.remove('rc-stream');
    this.secondary.hidden = false;
  }
}
