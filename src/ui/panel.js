import { ReadingNotesPanel } from './reading-notes.js';
import { Onboarding } from './onboarding.js';
import { errorControls } from './error-controls.js';
import { ModelMenu } from './model-menu.js';
import { addReference } from '../domain/references.js';
import { icon, iconAction, labeledAction } from './icons.js';
import { NotebookPanel } from './notebook.js';
import { element, action, labeledControl } from './dom.js';
import { pageExamples } from '../domain/material.js';
import { renderTurn } from './turn.js';
import { renderRichText } from './rich-text.js';
import { modelCapabilities } from '../domain/configuration.js';
import { correctTerm } from '../domain/glossary.js';
import { errorFeedback } from '../domain/errors.js';

const defaultQuestions = {
  vision: '请解释当前图。明确图中可见、原文规定和推导，给出出处。',
  'translate-page': '翻译当前页，保留原文对照、条件、表头和脚注。',
  'translate-selection': '翻译当前选区，保留原文对照和限定条件。',
  explain: '讲懂用户引用的文字。没有引用时只讲当前页第一段，并说明出处。',
  'summary-discussion': '总结本篇已讨论内容，逐项给出处并说明实际覆盖范围。',
  'summary-paragraph': '简短总结当前页的要点，并保留重要限制。',
  'summary-page': '总结本页',
  'summary-chapter': '总结本章',
  'summary-all': '整理实际收到的各页要点，明确覆盖范围和未覆盖的部分。',
};

/** A short, time-aware opener for the empty state. */
function greeting(date = new Date()) {
  const hour = date.getHours();
  const time =
    hour < 5
      ? '夜深了'
      : hour < 11
        ? '早上好'
        : hour < 13
          ? '中午好'
          : hour < 18
            ? '下午好'
            : '晚上好';
  return `${time}，想从哪里读起？`;
}

export class ReadingPanel {
  constructor(document, body, application, onBack = () => {}) {
    this.onBack = onBack;
    this.document = document;
    this.application = application;
    this.documentId = null;
    this.activeReader = null;
    this.session = null;
    this.renderedTurns = new Map();
    this.references = [];
    this.includePage = true;
    this.build(body);
    this.notebook = new NotebookPanel(this);
    if (application.readingNotes) this.notes = new ReadingNotesPanel(this);
    if (application.setup) {
      this.onboarding = new Onboarding(this);
      if (
        !application.environment.Zotero.Prefs.get(
          'extensions.readingCompanion.onboardingComplete',
          true,
        )
      )
        this.onboarding.show();
      this.onboarding.check();
    }
    this.unsubscribe = application.sessions.subscribe((identifier, state) => {
      if (identifier !== this.documentId) return;
      this.updateState(state);
      if (state.turn) this.displayTurn(state.turn);
    });
    this.timer = setInterval(() => this.refresh().catch(() => {}), 700);
    this.refresh().catch(() => {});
  }

  build(body) {
    const document = this.document;
    this.root = element(document, 'div', null, { class: 'rc-panel', lang: 'zh-CN' });
    this.basis = element(document, 'div', null, { class: 'rc-context' });
    this.fixed = action(
      document,
      '',
      () => {
        this.pinnedEvidence = null;
        this.useCurrentPage = true;
        this.renderBasis(this.viewState);
      },
      { class: 'rc-page-chip', title: '点击换成正在阅读的页' },
    );
    this.current = element(document, 'span', '', { hidden: '' });
    this.removePage = iconAction(document, '不带上这一页', 'close', () => {
      this.includePage = false;
      this.renderBasis(this.viewState);
    });
    this.pageChip = element(document, 'div', null, { class: 'rc-context-chip rc-page-context' });
    this.pageChip.append(this.fixed, this.removePage);
    this.quoteChips = element(document, 'div', null, { class: 'rc-quote-chips' });
    this.basis.append(this.pageChip, this.quoteChips);
    this.more = element(document, 'div', null, {
      class: 'rc-menu rc-header-menu',
      role: 'menu',
      hidden: '',
    });
    const menuButton = iconAction(
      document,
      '更多',
      'more',
      () => {
        this.more.hidden = !this.more.hidden;
        menuButton.setAttribute('aria-expanded', String(!this.more.hidden));
      },
      { 'aria-expanded': 'false' },
    );
    this.notebookMenu = action(document, '整理成笔记', () => this.notebook.open('annotations'));
    this.more.append(
      action(document, '本篇术语表', () => this.showGlossary()),
      action(document, '导出当前回答为子笔记', async () => {
        this.more.hidden = true;
        const turn = this.session?.turns.findLast((entry) => entry.answer);
        if (!turn) return;
        try {
          await this.application.saveNote(turn);
          this.flash('已保存为当前文献的子笔记。');
        } catch (error) {
          this.localError(error);
        }
      }),
      element(document, 'hr'),
      action(document, '模型设置', () => {
        this.more.hidden = true;
        this.application.openSettings();
      }),
      action(document, '连接账号', () => {
        this.more.hidden = true;
        this.onboarding?.show();
      }),
      element(document, 'hr'),
      action(document, '关闭侧栏', () => {
        this.more.hidden = true;
        this.onBack();
      }),
    );
    this.notesButton = iconAction(
      document,
      '笔记',
      'notes',
      () => {
        if (this.notes?.active) this.notes.close();
        else this.notes?.open();
      },
      { class: 'rc-icon-button rc-notes-toggle', 'aria-pressed': 'false' },
    );
    this.notesButton.title = '这篇文献的划线和笔记';
    const header = element(document, 'header', null, { class: 'rc-reading-header' });
    header.append(
      element(document, 'strong', 'Scholia', { class: 'rc-title' }),
      this.notesButton,
      iconAction(document, '新对话', 'plus', () => this.newConversation()),
      iconAction(document, '历史对话', 'history', () => this.showHistory()),
      menuButton,
      this.more,
    );
    this.conversation = element(document, 'div', null, {
      class: 'rc-conversation',
      'aria-label': '本篇阅读会话',
      tabindex: '0',
    });
    this.empty = element(document, 'div', null, { class: 'rc-empty' });
    this.exampleButtons = [];
    this.emptyMessage = element(document, 'p', greeting(), {
      class: 'rc-empty-title',
    });
    this.empty.append(this.emptyMessage);
    this.emptyAction = action(document, '打开模型设置', () => this.application.openSettings(), {
      class: 'rc-example',
      hidden: '',
    });
    this.empty.append(this.emptyAction);
    for (const [question, description, iconName] of [
      ['总结全文', '结论、方法、结果和局限', 'summary'],
      ['翻译这一页', '原文和中文对照', 'translate'],
      ['选中一段文字来提问', '在 PDF 里选中后点“引用”', 'quotation'],
    ]) {
      const button = action(
        document,
        '',
        () => {
          if (question === '总结全文') this.runPurpose('summary-all');
          else if (question === '翻译这一页') this.runPurpose('translate-page');
          else this.flash('在 PDF 里选中一段文字，然后点“引用”。');
        },
        { class: 'rc-example', 'aria-label': question },
      );
      const text = element(document, 'span', null, { class: 'rc-example-text' });
      text.append(element(document, 'span', question), element(document, 'small', description));
      button.append(icon(document, iconName), text);
      this.exampleButtons.push(button);
      this.empty.append(button);
    }
    this.conversation.append(this.empty);
    this.latest = action(
      document,
      '回到最新',
      () => {
        this.conversation
          .querySelector('.rc-turn:last-child')
          ?.scrollIntoView?.({ block: 'start' });
        this.latest.hidden = true;
      },
      { class: 'rc-latest', hidden: '' },
    );
    for (const type of ['wheel', 'touchmove', 'pointerdown'])
      this.conversation.addEventListener(
        type,
        () => {
          this.userScrolled = true;
        },
        { passive: true },
      );
    this.conversation.addEventListener('scroll', () => {
      this.latest.hidden =
        !this.userScrolled ||
        this.conversation.scrollHeight -
          this.conversation.scrollTop -
          this.conversation.clientHeight <
          48;
    });
    this.purpose = { value: 'ask' };
    this.model = { value: '' };
    this.input = element(document, 'textarea', null, {
      rows: 1,
      placeholder: '问这一页…',
      'aria-label': '问题',
    });
    this.draftRevision = 0;
    this.input.addEventListener('input', () => {
      this.draftRevision++;
      this.resizeInput();
      this.send.disabled = !this.input.value.trim();
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.submit().catch((error) => this.localError(error));
      }
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.more.hidden = true;
        if (!this.modelMenu.root.hidden) {
          this.modelMenu.close();
          this.modelMenu.button.focus();
          return;
        }
        this.application.sessions.cancel(this.documentId);
        this.notebook.cancel();
      }
    });
    this.send = iconAction(
      document,
      '发送',
      'send',
      () => {
        this.submit().catch((error) => this.localError(error));
      },
      { class: 'rc-icon-button rc-primary' },
    );
    this.cancel = iconAction(
      document,
      '停止生成',
      'stop',
      () => {
        this.application.sessions.cancel(this.documentId);
        this.notebook.cancel();
      },
      { class: 'rc-icon-button rc-stop', hidden: '' },
    );
    this.status = element(document, 'div', '', {
      role: 'status',
      'aria-live': 'polite',
      class: 'rc-status',
    });
    this.secondary = element(document, 'div', null, {
      class: 'rc-menu rc-quick-menu',
      role: 'menu',
      hidden: '',
      'aria-label': '快捷操作',
    });
    const quick = labeledAction(
      document,
      '快捷',
      'sparkle',
      () => {
        this.secondary.hidden = !this.secondary.hidden;
        this.modelMenu.close();
        quick.setAttribute('aria-expanded', String(!this.secondary.hidden));
      },
      { class: 'rc-quick-button', 'aria-expanded': 'false', title: '总结、翻译和整理笔记' },
    );
    this.quickButton = quick;
    this.translateAction = action(document, '翻译这一页', () => this.runPurpose('translate-page'));
    this.explainAction = action(document, '讲懂这段', () => this.runPurpose('explain'));
    this.secondary.append(
      action(document, '总结全文', () => this.runPurpose('summary-all')),
      action(document, '总结本页', () => this.runPurpose('summary-page')),
      action(document, '总结本章', () => this.runPurpose('summary-chapter')),
      element(document, 'hr'),
      this.translateAction,
      this.explainAction,
      this.notebookMenu,
      element(document, 'hr'),
      action(document, '带上正在阅读的页', () => {
        this.includePage = true;
        this.useCurrentPage = true;
        this.renderBasis(this.viewState);
        this.secondary.hidden = true;
      }),
      action(document, '引用上一条回答', () => {
        const turn = this.session?.turns.findLast((entry) => entry.answer);
        if (turn)
          this.addReference({
            text: turn.answer.text,
            kind: 'answer',
            pageIndex: turn.snapshot.pageIndex,
          });
        this.secondary.hidden = true;
      }),
    );
    this.modelMenu = new ModelMenu(this);
    const bar = element(document, 'div', null, { class: 'rc-composer-bar' });
    bar.append(
      quick,
      this.modelMenu.button,
      element(document, 'span', null, { class: 'rc-spacer' }),
      this.send,
      this.cancel,
    );
    const composer = element(document, 'footer', null, { class: 'rc-composer' });
    composer.append(this.basis, this.input, bar, this.modelMenu.root, this.secondary);
    this.root.append(header, this.conversation, this.latest, this.status, composer);
    // Popovers close on any press outside themselves and their own button.
    this.root.addEventListener('pointerdown', (event) => {
      for (const [menu, button] of [
        [this.more, menuButton],
        [this.secondary, quick],
        [this.modelMenu.root, this.modelMenu.button],
      ]) {
        if (menu.hidden || menu.contains(event.target) || button.contains(event.target)) continue;
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    body.append(this.root);
    this.refreshModels();
  }

  resizeInput() {
    this.input.style.height = 'auto';
    const line =
      parseFloat(this.document.defaultView.getComputedStyle(this.input).lineHeight) || 22;
    this.input.style.height = `${Math.min(this.input.scrollHeight, line * 6 + 24)}px`;
  }

  runPurpose(purpose) {
    this.secondary.hidden = true;
    this.purpose.value = purpose;
    this.refreshModels();
    this.submit(defaultQuestions[purpose])
      .catch((error) => this.localError(error))
      .finally(() => {
        if (this.purpose.value !== purpose) return;
        this.purpose.value = 'ask';
        this.refreshModels();
      });
  }

  setEmptyFeedback(feedback) {
    this.emptyFeedback = feedback;
    this.emptyMessage.textContent = feedback || greeting();
    this.empty.classList.toggle('rc-empty-feedback', Boolean(feedback));
    this.emptyAction.hidden = !feedback;
    for (const button of this.exampleButtons) button.hidden = Boolean(feedback);
  }

  showGlossary() {
    this.more.hidden = true;
    const existing = this.conversation.querySelector('.rc-glossary');
    if (existing) existing.remove();
    const glossary = this.glossary();
    this.conversation.append(glossary);
    glossary.scrollIntoView?.({ block: 'end' });
  }

  renderBasis(current) {
    if (!current || !this.modelMenu) return;
    const fixed = this.useCurrentPage ? null : this.pinnedEvidence || this.latestSnapshot;
    const target = fixed?.document.id === current.document.id ? fixed : current;
    this.basisTarget = target;
    this.pageChip.hidden = !this.includePage;
    const inherited = target === fixed;
    const provider = this.modelMenu.provider(
      this.application.store
        .configuration()
        .providers.find((entry) => entry.id === this.model.value),
    );
    const figure = (target.examples ||
      (target.pageIndex === current.pageIndex
        ? current.examples
        : pageExamples(
            target.sources?.find((source) => source.pageIndex === target.pageIndex)?.text,
          )) ||
      [])[0]?.includes('这张图');
    const noImage = figure && provider && !modelCapabilities(provider).vision;
    this.fixed.replaceChildren(
      icon(this.document, inherited ? 'lock' : 'page'),
      this.document.createTextNode(`第 ${target.pageIndex + 1} 页`),
    );
    this.fixed.title = inherited
      ? `继续讨论这一页；点击换成当前第 ${current.pageIndex + 1} 页`
      : '这次带上正在阅读的页';
    if (noImage) {
      this.fixed.title += '。此模型看不到图，可在左下角选择支持图像的模型。';
      this.fixed.append(element(this.document, 'small', '看不到图'));
    }
    this.fixed.dataset.locked = String(inherited);
    this.quoteChips.replaceChildren();
    for (const [index, reference] of this.references.entries()) {
      const chip = element(this.document, 'div', null, { class: 'rc-context-chip' });
      chip.append(
        action(
          this.document,
          reference.text,
          () =>
            this.application.reader.navigate(current, {
              pageIndex: reference.pageIndex,
              position: reference.position,
            }),
          { class: 'rc-quote-text', title: reference.text },
        ),
        element(
          this.document,
          'small',
          reference.kind === 'answer' ? '回答' : `p.${reference.pageIndex + 1}`,
        ),
        iconAction(this.document, '移除引用', 'close', () => {
          this.references.splice(index, 1);
          this.renderBasis(this.viewState);
        }),
      );
      this.quoteChips.append(chip);
    }
  }

  addReference(reference) {
    this.references = addReference(this.references, reference);
    const added = this.references.at(-1);
    if (added.originalLength > added.text.length)
      this.flash(
        `引用保留 ${added.text.length} 字，已截去 ${added.originalLength - added.text.length} 字。`,
      );
    this.renderBasis(this.viewState);
    this.input.focus();
  }

  async newConversation() {
    if (!this.session || this.application.sessions.running.has(this.documentId)) return;
    this.notebook.close();
    this.session.conversations ||= [];
    if (this.session.turns.length)
      this.session.conversations.push({
        id: this.application.identifier(),
        createdAt: this.session.startedAt || this.session.turns[0].snapshot.capturedAt,
        turns: this.session.turns,
      });
    this.session.turns = [];
    this.session.startedAt = new Date().toISOString();
    await this.application.store.saveSession(this.session);
    this.resetConversation();
  }

  resetConversation() {
    this.conversation.replaceChildren();
    this.renderedTurns.clear();
    this.references = [];
    this.includePage = true;
    this.pinnedEvidence = null;
    this.latestSnapshot = this.session.turns.at(-1)?.snapshot;
    this.useCurrentPage = !this.latestSnapshot;
    this.input.value = '';
    this.status.textContent = '';
    if (!this.session.turns.length) this.conversation.append(this.empty);
    for (const turn of this.session.turns) this.displayTurn(turn, false);
    if (this.session.summary) {
      this.restoreSummary();
    }
    this.secondary.hidden = true;
    this.renderBasis(this.viewState);
  }

  showHistory() {
    if (!this.session) return;
    this.conversation.querySelector('.rc-history')?.remove();
    const list = element(this.document, 'section', null, { class: 'rc-history rc-sheet' });
    const heading = element(this.document, 'div', null, { class: 'rc-sheet-header' });
    heading.append(
      element(this.document, 'h3', '这篇文献的对话'),
      iconAction(this.document, '关闭', 'close', () => list.remove()),
    );
    list.append(heading);
    const conversations = this.session.conversations || [];
    if (!conversations.length)
      list.append(element(this.document, 'p', '还没有其他对话。', { class: 'rc-sheet-empty' }));
    const when = (value) =>
      new Date(value).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    for (const entry of [...conversations].reverse()) {
      const row = element(this.document, 'div', null, { class: 'rc-history-row' });
      const title = entry.turns[0]?.displayQuestion || entry.turns[0]?.question || '新对话';
      const open = action(
        this.document,
        '',
        async () => {
          if (this.application.sessions.running.has(this.documentId)) return;
          const turns = this.session.turns;
          const startedAt = this.session.startedAt;
          this.session.turns = entry.turns;
          this.session.startedAt = entry.createdAt;
          this.session.conversations = conversations.filter((item) => item !== entry);
          if (turns.length)
            this.session.conversations.push({
              id: this.application.identifier(),
              turns,
              createdAt: startedAt || turns[0].snapshot.capturedAt,
            });
          await this.application.store.saveSession(this.session);
          this.resetConversation();
        },
        { title },
      );
      open.append(
        element(this.document, 'span', title, { class: 'rc-history-title' }),
        element(this.document, 'small', `${when(entry.createdAt)} · ${entry.turns.length} 轮`, {
          class: 'rc-history-meta',
        }),
      );
      row.append(
        open,
        iconAction(this.document, '删除这段历史对话', 'trash', async () => {
          this.session.conversations = this.session.conversations.filter((item) => item !== entry);
          await this.application.store.saveSession(this.session);
          row.remove();
        }),
      );
      list.append(row);
    }
    this.conversation.prepend(list);
    this.conversation.scrollTop = 0;
  }

  glossary() {
    const document = this.document;
    const details = element(document, 'section', null, { class: 'rc-glossary rc-sheet' });
    const original = element(document, 'input', null, { placeholder: 'e.g. assertion' });
    const translated = element(document, 'input', null, { placeholder: '例如 断言' });
    const context = element(document, 'input', null, { placeholder: '只在含这段文字时使用' });
    const list = element(document, 'ul', null, { class: 'rc-term-list' });
    const render = () => {
      list.replaceChildren();
      const terms = this.session?.glossary || [];
      if (!terms.length)
        list.append(
          element(document, 'li', '还没有术语。纠正过的译法会用于本篇之后的翻译和回答。', {
            class: 'rc-sheet-empty',
          }),
        );
      for (const term of terms) {
        const row = element(document, 'li');
        row.append(
          element(document, 'span', term.source, { class: 'rc-term-source', lang: 'en' }),
          element(document, 'span', term.translation, { class: 'rc-term-target' }),
        );
        if (term.context) row.append(element(document, 'small', term.context));
        list.append(row);
      }
    };
    const heading = element(document, 'div', null, { class: 'rc-sheet-header' });
    heading.append(
      element(document, 'h3', '本篇术语表'),
      iconAction(document, '收起术语表', 'close', () => details.remove()),
    );
    const form = element(document, 'div', null, { class: 'rc-term-form' });
    details.append(heading, list, form);
    form.append(
      labeledControl(document, '原词', original),
      labeledControl(document, '译法', translated),
      labeledControl(document, '语境，可留空', context),
      action(
        document,
        '保存纠正',
        async () => {
          try {
            if (!this.session) throw new Error('请先打开 PDF。');
            this.session.glossary = correctTerm(
              this.session.glossary,
              original.value,
              translated.value,
              context.value,
            );
            await this.application.store.saveSession(this.session);
            render();
            this.flash('已保存，本篇后续请求会使用此译法。');
          } catch (error) {
            this.localError(error);
          }
        },
        { class: 'rc-button' },
      ),
    );
    render();
    return details;
  }

  refreshModels() {
    const configuration = this.application.store.configuration();
    const purpose = this.purpose.value;
    const route = purpose.startsWith('translate')
      ? 'translate'
      : purpose === 'vision'
        ? 'vision'
        : 'ask';
    this.model.value = configuration.routes[route];
    this.updateCapability();
  }

  updateCapability() {
    this.modelMenu?.updateLabel();
  }

  async refresh() {
    if (!this.root.isConnected) return;
    let state;
    try {
      this.activeReader = this.application.reader.active(this.document);
      state = this.application.reader.current(this.activeReader);
    } catch {
      this.current.textContent = '请打开 PDF';
      this.send.disabled = true;
      return;
    }
    if (
      state.document.id !== this.viewState?.document.id ||
      state.pageIndex !== this.viewState?.pageIndex
    )
      this.setEmptyFeedback(null);
    this.viewState = state;
    this.hasSelection = Boolean(state.selection?.text);

    const identifier = state.document.id;
    if (identifier !== this.documentId) {
      this.notebook.close();
      this.pinnedEvidence = null;
      this.references = [];
      this.includePage = true;
      this.useCurrentPage = false;
      this.documentId = identifier;
      this.session = await this.application.store.session(identifier);
      if (this.notes?.active) this.notes.refresh();
      if (this.documentId !== identifier) return;
      this.conversation.replaceChildren();
      this.renderedTurns.clear();
      if (!this.session.turns.length) this.conversation.append(this.empty);
      for (const turn of this.session.turns) this.displayTurn(turn, false);
      if (this.session.summary) {
        this.restoreSummary();
      }
      this.latestSnapshot = this.session.turns.at(-1)?.snapshot;
      this.status.textContent = '';
    }
    this.notebookMenu.hidden = this.notebook.active;
    this.renderBasis(state);
    const busy = this.application.sessions.running.has(identifier) || this.notebook.busy;
    this.send.hidden = busy;
    this.cancel.hidden = !busy;
    this.send.disabled = busy || !this.input.value.trim();
    this.cancel.disabled = !busy;
  }

  updateState(state) {
    this.root.dataset.state = state.state;
    if (state.turn) this.latestSnapshot = state.turn.snapshot;
    const busy = ['preparing', 'evidence-fixed', 'streaming'].includes(state.state);
    this.send.disabled = busy || !this.input.value.trim();
    this.cancel.disabled = !busy;
    if (state.state === 'evidence-fixed') {
      this.latestSnapshot = state.capture;
    }
    this.renderBasis(this.viewState);
    this.send.hidden = busy;
    this.cancel.hidden = !busy;
    if (state.state === 'preparing') {
      this.setEmptyFeedback(null);
      this.status.textContent = state.message || '';
    }
    if (state.state === 'streaming') this.status.textContent = '';
    if (state.state === 'complete') this.status.textContent = '';
    if (state.state === 'needs-review')
      this.status.textContent = '译文有待核对的位置，已逐段标出。';
    if (state.error) this.showError(state.error);
  }

  showError(feedback) {
    const emptyMessages = {
      unconfigured: '尚未配置模型，请先选择一个模型。',
      executable: '未找到 Codex，请检查模型设置中的路径。',
      key: '密钥无效或未配置，请检查模型设置。',
      'no-text-translation': '本页没有文本层，可配置图像模型解读页面。',
    };
    if (emptyMessages[feedback.code] && !this.session?.turns.some((turn) => turn.answer)) {
      this.setEmptyFeedback(emptyMessages[feedback.code]);
      if (!this.empty.isConnected) this.conversation.append(this.empty);
      this.status.replaceChildren(
        errorControls(
          this.document,
          this.application,
          feedback,
          this.application.store
            .configuration()
            .providers.find((entry) => entry.id === this.model.value),
        ),
      );
      return;
    }
    this.status.replaceChildren(
      element(this.document, 'strong', feedback.title),
      element(
        this.document,
        'p',
        (feedback.filePage ? `PDF 第 ${feedback.filePage} 页。` : '') + feedback.reason,
      ),
      element(this.document, 'p', feedback.action),
      errorControls(
        this.document,
        this.application,
        feedback,
        this.application.store
          .configuration()
          .providers.find((entry) => entry.id === this.model.value),
        { retry: () => this.submit().catch((error) => this.localError(error)) },
      ),
    );
  }

  async submit(forcedQuestion) {
    if (this.notebook.active) {
      if (this.input.value.trim()) await this.notebook.run(this.input.value.trim());
      return;
    }
    if (!this.activeReader) throw new Error('请先打开 PDF。');
    if (this.application.sessions.running.has(this.documentId)) return;
    const purpose = this.purpose.value;
    const question = forcedQuestion || this.input.value.trim() || defaultQuestions[purpose];
    if (!question) throw new Error('请输入问题。Enter 发送，Shift+Enter 换行。');
    const configured = this.application.store.configuration().providers.find((entry) => {
      return entry.id === this.model.value;
    });
    const provider =
      purpose === 'ask' || purpose.startsWith('summary-')
        ? this.modelMenu.provider(configured)
        : configured;
    const references = [...this.references];
    const documentId = this.documentId;
    const draft = forcedQuestion ? null : this.input.value;
    const revision = this.draftRevision;
    if (draft) this.setDraft('');
    this.userScrolled = false;
    this.conversation.style.paddingBottom = '16px';
    let turn;
    try {
      turn = await this.application.sessions.send({
        activeReader: this.activeReader,
        question,
        purpose,
        provider,
        mode: purpose === 'ask' && !this.useCurrentPage ? 'previous' : 'current',
        discussionEvidence: this.pinnedEvidence,
        references,
        includePage: this.includePage,
        ignoreSelection: true,
        displayQuestion:
          forcedQuestion === defaultQuestions[purpose]
            ? {
                'translate-page': '翻译本页',
                'summary-paragraph': '总结本页',
                explain: '讲懂这段',
              }[purpose]
            : undefined,
      });
    } finally {
      if (
        draft &&
        !turn?.answer &&
        this.documentId === documentId &&
        !this.notebook.active &&
        this.draftRevision === revision &&
        !this.input.value
      )
        this.setDraft(draft);
    }
    if (this.documentId !== documentId) return;
    this.pinnedEvidence = null;
    if (turn?.answer) {
      this.references = [];
      if (!this.userScrolled) this.focusTurn(turn);
      this.useCurrentPage = false;
      this.renderBasis(this.viewState);
    }
  }

  setDraft(text) {
    this.input.value = text;
    this.resizeInput();
    this.send.disabled = !text.trim() || this.send.hidden;
  }

  async retryTurn(turn) {
    const provider = this.application.store
      .configuration()
      .providers.find((entry) => entry.id === turn.provider.id);
    const result = await this.application.sessions.send({
      activeReader: this.activeReader,
      question: turn.question,
      purpose: turn.purpose,
      provider,
      capturedEvidence: turn.snapshot,
      references: turn.snapshot.references || [],
      includePage: turn.snapshot.includePage !== false,
      mode: 'previous',
      discussionEvidence: turn.snapshot,
      regenerate: Boolean(turn.summary),
    });
    if (result?.answer) this.focusTurn(result);
  }

  /** Shows a stored summary once and lands on it only when nothing newer follows it. */
  restoreSummary() {
    const summary = this.session.summary;
    if (!this.renderedTurns.has(summary.id)) this.displayTurn(summary, false);
    const window = this.document.defaultView;
    if (this.session.turns.at(-1)?.id === summary.id || !this.session.turns.length)
      window.requestAnimationFrame(() => this.focusTurn(summary));
    else window.requestAnimationFrame(() => (this.conversation.scrollTop = 1e9));
  }

  focusTurn(turn) {
    const node = this.renderedTurns.get(turn.id);
    if (!node) return;
    const space = this.conversation.clientHeight - node.getBoundingClientRect().height;
    this.conversation.style.paddingBottom = `${Math.max(16, space)}px`;
    node.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }

  displayTurn(turn, follow = true) {
    const nearBottom =
      this.conversation.scrollHeight -
        this.conversation.scrollTop -
        this.conversation.clientHeight <
      48;
    const previous = this.renderedTurns.get(turn.id);
    if (turn.state === 'failed' && this.emptyFeedback) {
      previous?.remove();
      this.renderedTurns.delete(turn.id);
      return;
    }
    if (previous && turn.state === 'streaming') {
      const stream = previous.querySelector('.rc-stream');
      if (stream) {
        stream.replaceChildren(renderRichText(this.document, turn.preview));
        if (nearBottom) this.conversation.scrollTop = this.conversation.scrollHeight;
        return;
      }
    }
    const node = renderTurn(this.document, turn, {
      errorActions: (feedback) =>
        errorControls(this.document, this.application, feedback, turn.provider, {
          loggedIn: () => this.flash('已重新登录，点击原回答下的“重试这次提问”继续。'),
          retry: () => this.retryTurn(turn),
        }),
      regenerate: async () => {
        this.userScrolled = false;
        const result = await this.application.sessions.send({
          activeReader: this.activeReader,
          purpose: turn.purpose,
          provider: this.modelMenu.provider(
            this.application.store
              .configuration()
              .providers.find((entry) => entry.id === this.model.value),
          ),
          regenerate: true,
        });
        if (result?.answer && !this.userScrolled) this.focusTurn(result);
      },
      followup: (question) => {
        this.pinnedEvidence = turn.snapshot;
        this.useCurrentPage = false;
        this.includePage = true;
        return this.submit(question).catch((error) => this.localError(error));
      },
      modelName: (provider) => {
        const selected = this.modelMenu.selected;
        const name =
          selected && selected.providerId === provider.id && selected.model === provider.model
            ? selected.name
            : provider.displayName;
        return this.application.models?.displayName({ ...provider, displayName: name });
      },
      navigate: (...arguments_) =>
        this.application.reader.navigate(...arguments_).catch((error) => this.localError(error)),
      copy: (entry) => this.application.copy(entry),
      reference: (entry) => {
        const selected = this.document.defaultView.getSelection()?.toString().trim();
        this.addReference({
          kind: 'answer',
          text: selected || entry.answer.text,
          pageIndex: entry.snapshot.pageIndex,
          turnId: entry.id,
        });
      },
      highlight: async (entry, citation, claim) => {
        try {
          await this.application.annotations.cite(entry.snapshot, citation, claim.text);
          this.flash('已在原文中标出。');
        } catch (error) {
          this.localError(error);
        }
      },
      saveNote: async (entry) => {
        try {
          const selection = this.document.defaultView.getSelection();
          const node = this.renderedTurns.get(entry.id);
          const selected =
            selection?.rangeCount &&
            node?.contains(selection.anchorNode) &&
            node?.contains(selection.focusNode)
              ? selection.toString().trim()
              : '';
          const item = await this.application.readingNotes.saveAnswer(entry, selected);
          this.flash(item.isAnnotation() ? '已记在原文划线的评论中。' : '已保存为未挂位置的笔记。');
        } catch (error) {
          this.localError(error);
        }
      },
      followTranslation: (entry, row) => {
        this.pinnedEvidence = entry.snapshot;
        this.purpose.value = 'ask';
        this.useCurrentPage = false;
        this.includePage = true;
        this.renderBasis(this.viewState);
        this.input.value = `这里为什么这样翻？\n原文 ${row.original}\n译文 ${row.translation}`;
        this.input.focus();
      },
    });
    this.empty.remove();
    if (previous) previous.replaceWith(node);
    else this.conversation.append(node);
    // Only a turn the user just started fades in; re-renders and restored history appear at once.
    if (follow && !previous) node.classList.add('rc-enter');
    this.renderedTurns.set(turn.id, node);
    if (follow && (!previous || nearBottom)) {
      this.conversation.scrollTop = this.conversation.scrollHeight;
    }
    if (follow && !previous) {
      // The native XUL host lays out a newly inserted round on its next frame.
      // Locate that round once; subsequent deltas still honor the reader's scroll position.
      this.document.defaultView.requestAnimationFrame?.(() => {
        const latest = this.renderedTurns.get(turn.id);
        if (latest?.isConnected) {
          latest.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
        }
      });
    }
  }

  flash(text) {
    this.status.textContent = text;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      if (this.status.textContent === text) this.status.textContent = '';
    }, 2500);
  }

  localError(error) {
    this.application.recordFailure?.(error, 'panel-action');
    if (error.code) this.showError(errorFeedback(error));
    else
      this.showError({
        title: '操作未完成',
        reason: error.message || '当前输入或阅读器尚未就绪。',
        action: '请检查问题和当前 PDF 后重试。',
      });
  }

  destroy() {
    this.notes?.destroy();
    this.onboarding?.destroy();
    this.notebook.close();
    clearInterval(this.timer);
    clearTimeout(this.statusTimer);
    this.unsubscribe();
    this.root.remove();
  }
}
