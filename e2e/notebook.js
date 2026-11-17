import { layouts, setLayout, saveWindow } from './screenshots.js';

export async function runNotebookAcceptance(context) {
  const { environment, reader, panel, window, root, translated, case_, until, assert } = context;
  const { Zotero, IOUtils, PathUtils } = environment;
  const attachment = Zotero.Items.get(reader.itemID);
  const click = (label, container = panel) => {
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === label || node.getAttribute('aria-label') === label,
    );
    assert(button && !button.disabled, 'Notebook control: ' + label);
    button.click();
  };
  await setLayout(environment, window, panel, layouts[0], context.wait);
  await case_('notebook-three-native-highlights', async () => {
    for (const text of [
      'assert',
      'The source shall not change DATA for 3 cycles.',
      'A latch stores a bit while its enable input is inactive.',
    ]) {
      const response = await translated(text);
      root().closest('.selection-popup').querySelector('.color-button').click();
      await until(
        () =>
          attachment
            .getAnnotations()
            .find(
              (item) =>
                item.annotationText === text && item.annotationComment === response.translation,
            ),
        'Native highlight with comment',
        10000,
      );
    }
    assert(attachment.getAnnotations().length === 3, 'Exactly three highlights before synthesis');
    return attachment.getAnnotations().map((item) => ({
      key: item.key,
      text: item.annotationText,
      comment: item.annotationComment,
      position: JSON.parse(item.annotationPosition),
    }));
  });
  await case_('notebook-two-discussions', async () => {
    const frame = reader._internalReader._primaryView._iframeWindow;
    const utils = environment.Components.utils.unwaiveXrays(frame).windowUtils;
    for (const type of ['mousedown', 'mouseup'])
      utils.sendMouseEventToWindow(type, frame.innerWidth - 30, frame.innerHeight - 30, 0, 1, 0);
    await context.wait(300);
    await context.submit(
      'notebook-discussion-one',
      '请改用当前页，说明 assert 的含义以及 DATA 在 3 个周期内能否改变。',
      'ask',
      layouts[0],
    );
    await context.submit(
      'notebook-discussion-two',
      '请举例：用 Sample 20 与 Sample 1 的延迟计算差值，写出 LaTeX 公式；' +
        '用小表格列出前三个 Sample 的数值。不要推断因果关系。',
      'ask',
      layouts[1],
    );
    assert((await context.readSession()).turns.length === 2, 'Exactly two completed discussions');
  });
  let firstDraft;
  await case_('notebook-preview-coverage-and-sources', async () => {
    click('更多');
    click('整理成笔记');
    await until(
      () => panel.querySelector('.rc-notebook')?.textContent.includes('基于 3 条标注和 2 轮对话'),
      'Coverage shown before generation',
    );
    click('生成笔记');
    firstDraft = await until(
      async () => (await context.readSession()).notebookDraft,
      'Actual synthesized notebook',
      210000,
    );
    assert(
      firstDraft.material.annotationCount === 3 && firstDraft.material.turnCount === 2,
      'Draft coverage matches imported annotations and completed turns',
    );
    const ids = new Set(firstDraft.material.sources.map((source) => source.id));
    assert(
      firstDraft.sections.every((section) =>
        section.points.every(
          (point) => point.sources.length && point.sources.every((id) => ids.has(id)),
        ),
      ),
      'Every notebook point resolves to provided evidence',
    );
    assert(!attachment.parentItem.getNotes().length, 'Preview does not save or overwrite notes');
    await context.matrix('notebook-preview');
    await IOUtils.writeJSON(
      PathUtils.join(context.config.runDirectory, 'notebook-first-draft.json'),
      firstDraft,
    );
  });
  let draft;
  let note;
  await case_('notebook-revise-save-and-explicit-update', async () => {
    panel.querySelector('textarea').value =
      '再简短点。保留 Sample 20 减 Sample 1 的 LaTeX 差值公式和前三项小表格；' +
      '保留三条标注的要点与出处，不新增材料没有的事实。';
    click('发送');
    draft = await until(
      async () => {
        const value = (await context.readSession()).notebookDraft;
        return value?.generatedAt !== firstDraft.generatedAt ? value : null;
      },
      'Revised notebook',
      210000,
    );
    click('新建子笔记');
    await until(
      () => panel.querySelector('.rc-notebook')?.textContent.includes('已新建子笔记'),
      'Notebook saved',
    );
    const session = await context.readSession();
    note = Zotero.Items.get(session.notebookNoteID);
    assert(
      note.parentID === attachment.parentID,
      'Notebook is a child of the correct literature item',
    );
    const html = note.getNote();
    assert(html.includes('基于 3 条标注和 2 轮对话'), 'Saved notebook carries actual coverage');
    const parsed = new window.DOMParser().parseFromString(html, 'text/html');
    const highlights = [...parsed.querySelectorAll('[data-annotation]')].map((node) =>
      JSON.parse(decodeURIComponent(node.getAttribute('data-annotation'))),
    );
    for (const annotation of attachment.getAnnotations()) {
      const link = highlights.find((entry) => entry.annotationKey === annotation.key);
      assert(
        link?.position.pageIndex === JSON.parse(annotation.annotationPosition).pageIndex,
        'Native annotation link retains the source page: ' + annotation.key,
      );
    }
    assert(
      parsed.querySelector('table') && parsed.querySelector('.math'),
      'Saved notebook contains native formula and table markup',
    );
    await IOUtils.writeUTF8(
      PathUtils.join(context.config.runDirectory, 'notebook-body.html'),
      html,
    );
    const id = note.id;
    click('更新原笔记');
    await until(
      () => panel.querySelector('.rc-notebook')?.textContent.includes('已更新原笔记'),
      'Explicit update completed',
    );
    assert(
      (await context.readSession()).notebookNoteID === id,
      'Explicit update keeps the same note',
    );
    click('新建子笔记');
    await until(
      async () => (await context.readSession()).notebookNoteID !== id,
      'Explicit new note',
    );
    assert(
      attachment.parentItem.getNotes().length === 2,
      'New versus update is a visible user choice',
    );
    await IOUtils.writeJSON(
      PathUtils.join(context.config.runDirectory, 'notebook-final-draft.json'),
      draft,
    );
  });
  await case_('notebook-native-editor-formula-table', async () => {
    click('打开笔记');
    const editorWindow = await until(
      () =>
        [...environment.Services.wm.getEnumerator(null)].find(
          (entry) => entry !== window && entry.document.querySelector('note-editor'),
        ),
      'Native Zotero note window',
    );
    const editor = editorWindow.document.querySelector('note-editor');
    const body = await until(
      () => editor._iframe?.contentDocument?.querySelector('.ProseMirror'),
      'Native note editor content',
    );
    await until(
      () => body.querySelector('.katex') && body.querySelector('table'),
      'Native editor renders formula and table',
    );
    editorWindow.resizeTo(900, 850);
    await context.wait(400);
    const formula = body.querySelector('.katex');
    formula.scrollIntoView({ block: 'center' });
    assert(formula.getBoundingClientRect().width > 0, 'Native formula is visually rendered');
    for (const theme of ['light', 'dark']) {
      editorWindow.browsingContext.prefersColorSchemeOverride = theme;
      await context.wait(300);
      const filename = `notebook-native-editor-${theme}.png`;
      const shot = await saveWindow(
        environment,
        editorWindow,
        PathUtils.join(context.config.runDirectory, 'screenshots', filename),
      );
      context.report.screenshots.push({
        name: 'notebook-native-editor',
        filename,
        requested: { theme, width: 900 },
        ...shot,
      });
    }
    await IOUtils.writeUTF8(
      PathUtils.join(context.config.runDirectory, 'notebook-editor.html'),
      body.innerHTML,
    );
    editorWindow.close();
    return { noteID: note.id, nativeFormula: true, nativeTable: true };
  });
}
