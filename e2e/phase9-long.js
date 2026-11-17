import { setLayout, saveWindow } from './screenshots.js';
import { renderTurn } from '../src/ui/turn.js';
import { SelectionView } from '../src/ui/selection-view.js';

export async function runLongText(context) {
  const { environment, config, window, open, specification, until, wait, report, persist } =
    context;
  const { Zotero, PathUtils } = environment;
  const app = Zotero['reading-companion@local'];
  await open(specification, 0);
  const panel = app.workspaces.get(window).panel;
  await until(() => !panel.root.classList.contains('rc-setup-active'), 'Chat ready');
  report.scope = 'phase9-long-text';
  report.longText = [];
  panel.modelMenu.button.click();
  await until(() => panel.modelMenu.root.querySelector('.rc-efforts'), 'Effort controls');
  report.effortControls = [];
  for (const label of ['快', '标准', '深入', '标准']) {
    if (panel.modelMenu.root.hidden) panel.modelMenu.button.click();
    const button = [...panel.modelMenu.root.querySelectorAll('.rc-efforts button')].find(
      (node) => node.textContent === label,
    );
    if (!button) throw new Error('Missing effort: ' + label);
    button.click();
    report.effortControls.push({ label, effort: panel.modelMenu.selected.effort });
  }

  const original = '不能把2.50V改成3~5V；DATA[7:0]和RESET_N不变。https://example.org/2~3mg';
  const fixture = {
    id: 'phase10-content-fidelity',
    state: 'complete',
    question: original,
    snapshot: { ...app.reader.current(panel.activeReader), sources: [] },
    provider: { name: '内容保真样本' },
    answer: {
      text: original,
      claims: [{ text: original, kind: 'text', citations: [] }],
      uncertainties: [],
    },
  };
  panel.displayTurn(fixture, false);
  const node = panel.root.querySelector('[data-turn-id="phase10-content-fidelity"]');
  const display = node.querySelector('.rc-prose').textContent;
  let copied;
  const copy = Zotero.Utilities.Internal.copyTextToClipboard;
  try {
    Zotero.Utilities.Internal.copyTextToClipboard = (text) => {
      copied = text;
    };
    node.querySelector('[aria-label="复制回答"]').click();
  } finally {
    Zotero.Utilities.Internal.copyTextToClipboard = copy;
  }
  node.querySelector('[aria-label="存为笔记"]').click();
  const note = await until(
    async () =>
      (await app.readingNotes.list(specification.id)).find((entry) => entry.comment === original),
    'Raw native note content',
  );
  report.contentFidelity = {
    original,
    displayed: display,
    copied,
    saved: note.comment,
    question: node.querySelector('.rc-question .rc-collapse-text').textContent,
  };
  if (
    display.replace(/\s/gu, '') !== original.replace(/\s/gu, '') ||
    !copied.startsWith(original) ||
    note.comment !== original
  )
    throw new Error('Rendered/copy/note content changed');

  const paragraph = '这是一段用于检查长文字排版的测试内容，包含条件、结果和需要保留的解释。';
  for (const width of [380, 280]) {
    await setLayout(environment, window, panel.root, { theme: 'light', width }, wait);
    for (const [name, text] of [
      ['paragraph', paragraph.repeat(20)],
      ['multiline', Array(25).fill(paragraph).join('\n\n')],
      ['whole-page', paragraph.repeat(100)],
    ]) {
      panel.input.value = text;
      panel.input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await wait(100);
      const box = panel.input.getBoundingClientRect();
      const send = panel.send.getBoundingClientRect();
      report.longText.push({
        name,
        width,
        inputHeight: box.height,
        internalScroll: panel.input.scrollHeight > panel.input.clientHeight,
        sendVisible: send.bottom <= window.innerHeight && send.width > 0,
        conversationHeight: panel.conversation.clientHeight,
        overflow: panel.root.scrollWidth - panel.root.clientWidth,
      });
    }
    for (let index = 0; index < 5; index++) {
      try {
        panel.addReference({
          text: paragraph.repeat(35) + index,
          pageIndex: index,
          kind: 'original',
        });
      } catch (error) {
        report.referenceError = error.message;
      }
    }
    const snapshot = app.reader.current(panel.activeReader);
    const turn = {
      id: 'long-text-fixture',
      state: 'complete',
      snapshot,
      question: paragraph.repeat(35),
      provider: { name: '排版样本' },
      answer: {
        text: '',
        uncertainties: [],
        claims: [
          {
            kind: 'text',
            citations: [],
            text:
              'https://example.org/' +
              'ACGT'.repeat(350) +
              '\n\n' +
              '| 项目 | 内容 |\n| --- | --- |\n| 标识 | ' +
              'ABC'.repeat(300) +
              ' |\n\n' +
              '$$' +
              Array(50).fill('x_i').join('+') +
              '=1$$',
          },
        ],
      },
    };
    turn.snapshot.references = panel.references;
    panel.conversation.replaceChildren(renderTurn(window.document, turn, { navigate() {} }));
    const popup = new SelectionView(window.document, paragraph.repeat(40), false, 'long');
    popup.show({ meaning: paragraph.repeat(70) }, '排版样本');
    popup.actions({ quote() {}, follow() {}, copy() {}, more() {} }, false);
    Object.assign(popup.root.style, {
      position: 'fixed',
      left: '200px',
      top: '100px',
      zIndex: 9999,
    });
    window.document.documentElement.append(popup.root);
    await wait(200);
    report.longText.push({
      name: 'combined',
      width,
      referenceHeight: panel.quoteChips.getBoundingClientRect().height,
      sentReferenceHeight: panel.conversation.querySelector('.rc-cite-block')?.clientHeight,
      questionHeight: panel.conversation.querySelector('.rc-question')?.clientHeight,
      conversationOverflow: panel.conversation.scrollWidth - panel.conversation.clientWidth,
      popupHeight: popup.root.clientHeight,
      popupControlsVisible:
        popup.controls.getBoundingClientRect().bottom <= popup.root.getBoundingClientRect().bottom,
    });
    const filename = `long-${width}.png`;
    report.screenshots.push({
      filename,
      name: `long-${width}`,
      ...(await saveWindow(
        environment,
        window,
        PathUtils.join(config.runDirectory, 'screenshots', filename),
      )),
    });
    popup.root.remove();
    panel.references = [];
    panel.renderBasis(panel.viewState);
  }
  await persist();
}
