import { setLayout } from './screenshots.js';
import { createSelectionControls } from './selection.js';

export async function runReadingNotes(context) {
  const {
    environment,
    config,
    window,
    open,
    specification,
    until,
    wait,
    assert,
    case_,
    report,
    persist,
    click,
  } = context;
  const { Zotero, IOUtils, PathUtils } = environment;
  const app = Zotero['reading-companion@local'];
  let target = specification;
  if (config.only === 'phase9-notes-tail') {
    const id = await Zotero.DB.valueQueryAsync(
      'SELECT parentItemID FROM itemAnnotations GROUP BY parentItemID HAVING COUNT(*)=3',
    );
    assert(id, 'Seed contains the three native annotations');
    target = await Zotero.Items.getAsync(id);
    await target.loadAllData();
  }
  await open(target, config.only === 'phase9-notes-tail' ? 3 : 1);
  const panel = app.workspaces.get(window).panel;
  await until(() => !panel.root.classList.contains('rc-setup-active'), 'Chat ready');
  const reader = panel.activeReader;
  const attachment = Zotero.Items.get(reader.itemID);
  const controls = createSelectionControls({
    ...context,
    reader,
    panel: panel.root,
    allowExpandedSelection: true,
  });
  const configuration = app.store.configuration();
  configuration.translation.trigger = 'click';
  configuration.translation.annotationComment = false;
  app.store.saveConfiguration(configuration);
  report.scope = 'phase9-reading-notes';
  const comments = [
    '我认为这里约束的是接受边沿。\n第二句保留 2.50 V 与原话。',
    '',
    '另一页的规则需要单独区分。',
  ];
  const excerpts = [
    'The requirement lasts through the accepting rising edge.',
    'edge in Figure 1 is stalled, not accepted.',
    'does not apply to the SAMPLE channel.',
  ];
  const created = config.only === 'phase9-notes-tail' ? attachment.getAnnotations() : [];
  await setLayout(environment, window, panel.root, { theme: 'light', width: 380 }, wait);
  if (config.only !== 'phase9-notes-tail')
    await case_('选区中写笔记、空评论划线和另一页笔记', async () => {
      for (let index = 0; index < 3; index++) {
        if (index === 2) await open(specification, 3);
        if (index === 2)
          await controls.select('S3. Figure 2 is illustrative.', true, excerpts[index]);
        else await controls.select(excerpts[index]);
        const before = new Set(attachment.getAnnotations().map((item) => item.id));
        click(controls.root(), '记笔记');
        const input = controls.root().querySelector('[aria-label="我的笔记"]');
        assert(input, 'Inline note editor exists');
        input.value = comments[index];
        input.dispatchEvent(
          new input.ownerDocument.defaultView.KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
          }),
        );
        const item = await until(
          () => attachment.getAnnotations().find((entry) => !before.has(entry.id)),
          'Native highlight saved',
        );
        assert(
          (item.annotationComment || '') === comments[index],
          'User comment preserved exactly',
        );
        assert(item.annotationType === 'highlight', 'Native highlight annotation');
        created.push(item);
      }
      reader._internalReader.toggleSidebar(true);
      reader._internalReader.setSidebarView('annotations');
      await until(
        () =>
          reader._iframeWindow.document.querySelectorAll('[data-sidebar-annotation-id]').length >=
          3,
        'Three annotations in native sidebar',
      );
      const sidebar = reader._iframeWindow.document;
      assert(
        comments
          .filter(Boolean)
          .every((text) => sidebar.body.textContent.includes(text.split('\n')[0])),
        'Native sidebar shows user comments',
      );
      reader._internalReader.toggleSidebar(false);
      await wait(700);
    });
  await case_('笔记列表跳转、编辑、原生修改同步和针对提问', async () => {
    click(panel.root, '笔记');
    await until(() => panel.notes.entries?.length === 3, 'Notes opened from toolbar');
    report.noteListFeedback = panel.notes.feedback.textContent;
    report.loadedNotes = panel.notes.entries?.length;
    await persist();
    if (report.noteListFeedback) throw new Error(report.noteListFeedback);
    await until(
      () => panel.notes.list.querySelectorAll('.rc-reading-note').length === 3,
      'Note list loaded',
      10000,
    );
    click(panel.notes.list.querySelector(`[data-note-id="${created[0].id}"]`), 'p.2');
    await until(
      () => app.reader.current(reader).pageIndex === 1,
      'Jumped to annotation page',
      10000,
    );
    click(panel.notes.list.querySelector(`[data-note-id="${created[0].id}"]`), '编辑');
    comments[0] += '\n在列表补充的第三句。';
    panel.notes.list.querySelector('textarea').value = comments[0];
    click(panel.notes.list, '保存');
    await until(
      () => created[0].annotationComment === comments[0] && !panel.notes.editing,
      'Comment saved',
      10000,
    );
    // Use the reader's own annotation update path, which also backs its comment editor.
    const nativeComment = '从 Zotero 标注编辑路径修改的评论。';
    reader._internalReader._annotationManager.updateAnnotations(
      environment.Components.utils.cloneInto(
        [{ id: created[2].key, comment: nativeComment }],
        reader._iframeWindow,
      ),
    );
    await until(
      () => panel.notes.list.textContent.includes(nativeComment),
      'Native comment update reflected',
      15000,
    );
    comments[2] = nativeComment;
    panel.notes.search.value = '第三句';
    panel.notes.search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(
      panel.notes.list.querySelectorAll('.rc-reading-note').length === 1,
      'Search filters notes',
    );
    panel.notes.search.value = '';
    panel.notes.search.dispatchEvent(new window.Event('input', { bubbles: true }));
    click(panel.notes.list.querySelector(`[data-note-id="${created[0].id}"]`), '针对这条提问');
    assert(
      panel.references[0].text === created[0].annotationText,
      'Question carries original quotation',
    );
    panel.input.value = '用一句话解释这条规则。';
    panel.input.dispatchEvent(new window.Event('input', { bubbles: true }));
    click(panel.root, '发送');
    await until(() => {
      const last = panel.session.turns.at(-1);
      if (last?.state === 'failed') throw new Error(JSON.stringify(last.error));
      return last?.answer;
    }, 'Question about note answered');
  });
  await case_('整理、预览、保存并读回原话和链接', async () => {
    await panel.notes.open();
    click(panel.notes.root, '整理成一篇笔记');
    await until(() => panel.notebook.prepared, 'Annotation material prepared');
    click(panel.root, '生成笔记');
    await until(
      () => {
        if (panel.notebook.feedback.textContent && !panel.notebook.busy)
          throw new Error(panel.notebook.feedback.textContent);
        return panel.notebook.draft;
      },
      'Notes organized',
      240000,
    );
    assert(
      panel.notebook.draft.material.sources.length === 3,
      'Only user notes included by default',
    );
    const userPoints = panel.notebook.draft.sections
      .flatMap((section) => section.points)
      .filter((point) => point.kind === 'user')
      .map((point) => point.text);
    assert(
      comments.filter(Boolean).every((text) => userPoints.includes(text)),
      'Preview preserves exact comments',
    );
    click(panel.root, '新建子笔记');
    await until(() => panel.notebook.prepared.session.notebookNoteID, 'Child note saved');
    const note = Zotero.Items.get(panel.notebook.prepared.session.notebookNoteID);
    const html = note.getNote();
    assert(
      comments.filter(Boolean).every((text) => html.includes(text)),
      'Saved note preserves user wording',
    );
    assert(
      created.every((item) => html.includes('annotation=' + item.key)),
      'Links target all original annotations',
    );
    await IOUtils.writeUTF8(PathUtils.join(config.runDirectory, 'organized-note.html'), html);
    click(panel.root, '打开笔记');
    const editor = await until(
      () =>
        [...environment.Services.wm.getEnumerator(null)].find(
          (entry) => entry !== window && entry.document.querySelector('note-editor'),
        ),
      'Native note editor',
    );
    await until(
      () =>
        editor.document
          .querySelector('note-editor')
          ._iframe?.contentDocument?.querySelector('.ProseMirror')?.textContent,
      'Native editor content',
    );
    editor.close();
    panel.notebook.close();
    const answer = panel.session.turns.findLast((turn) => turn.answer);
    panel.focusTurn(answer);
    const previous = new Set((await app.readingNotes.list(reader.itemID)).map((entry) => entry.id));
    click(panel.root.querySelector(`[data-turn-id="${answer.id}"]`), '存为笔记');
    const savedAnswer = await until(
      async () =>
        (await app.readingNotes.list(reader.itemID)).find((entry) => !previous.has(entry.id)),
      'Answer button saves a native note',
      10000,
    );
    assert(
      savedAnswer.comment === answer.answer.claims.map((claim) => claim.text).join('\n\n'),
      'Answer text is saved without rewriting',
    );
    report.answerSavedAs = savedAnswer.annotation
      ? 'native highlight comment'
      : 'native child note';
    click(panel.root, '笔记');
    await until(() => panel.notes.entries?.length >= 3, 'Notes for export');
    const parent = Zotero.Items.get(attachment.parentID);
    const previousNotes = new Set(parent.getNotes());
    click(panel.notes.root, '导出');
    const exported = await until(
      () => parent.getNotes().find((id) => !previousNotes.has(id)),
      'Export button creates child note',
    );
    const exportedEditor = await until(
      () =>
        [...environment.Services.wm.getEnumerator(null)].find(
          (entry) => entry !== window && entry.document.querySelector('note-editor'),
        ),
      'Export opens native note editor',
    );
    exportedEditor.close();
    window.focus();
    assert(
      comments.filter(Boolean).every((text) => Zotero.Items.get(exported).getNote().includes(text)),
      'Direct export preserves comments without model',
    );
    report.annotationNotes = created.map((item) => ({
      key: item.key,
      comment: item.annotationComment,
      page: JSON.parse(item.annotationPosition).pageIndex + 1,
    }));
    await until(() => panel.notes.list.querySelector('[data-note-id]'), 'Notes list for deletion');
    const doomed = created[1];
    await persist();
    const services = app.environment.Services;
    app.environment.Services = new Proxy(services, {
      get: (target, name) => (name === 'prompt' ? { confirm: () => true } : target[name]),
    });
    try {
      click(panel.notes.list.querySelector(`[data-note-id="${doomed.id}"]`), '删除');
      await until(() => !Zotero.Items.get(doomed.id), 'Annotation erased');
      await until(
        () => !reader._internalReader._state.annotations.some((entry) => entry.id === doomed.key),
        'Deleted annotation gone from PDF',
      );
    } finally {
      app.environment.Services = services;
    }
    report.noteDeletion =
      'Actual list delete button and native PDF disappearance; confirmation accepted by harness';
    await persist();
  });
}

export async function runNoteStorage(context) {
  const { environment, window, open, specification, until, assert, case_, report, persist } =
    context;
  const { Zotero } = environment;
  const app = Zotero['reading-companion@local'];
  await open(specification, 1);
  const panel = app.workspaces.get(window).panel;
  await until(() => !panel.root.classList.contains('rc-setup-active'), 'Chat ready');
  const reader = panel.activeReader;
  const quote = 'The requirement lasts through the accepting rising edge.';
  await case_('原生颜色、译文分隔、回答定位、未挂位置与删除', async () => {
    reader._internalReader.setTool(
      environment.Components.utils.cloneInto(
        { type: 'highlight', color: '#ff6666' },
        reader._iframeWindow,
      ),
    );
    reader._internalReader.setTool(
      environment.Components.utils.cloneInto({ type: 'pointer' }, reader._iframeWindow),
    );
    const annotation = await app.reader.quotePosition(reader, { pageIndex: 1, quote });
    assert(annotation, 'Original text has unique native coordinates');
    const config = app.store.configuration();
    config.translation.annotationComment = true;
    app.store.saveConfiguration(config);
    const item = await app.readingNotes.create(reader, annotation, '用户自己的话', '测试译文');
    assert(item.annotationColor === '#ff6666', 'Last native highlight color reused');
    assert(
      item.annotationComment === '用户自己的话\n\n译文\n测试译文',
      'User words precede separate translation',
    );
    const turn = {
      snapshot: app.reader.current(reader),
      answer: {
        text: '回答片段',
        claims: [
          {
            text: '回答片段',
            citations: [
              { pageIndex: 1, quote, position: annotation.position, verifiedQuote: true },
            ],
          },
        ],
      },
    };
    const anchored = await app.readingNotes.saveAnswer(turn, '回答片段');
    assert(
      anchored.isAnnotation() && anchored.annotationComment === '回答片段',
      'Selected answer becomes native comment',
    );
    turn.answer.claims[0].citations = [];
    const unanchored = await app.readingNotes.saveAnswer(turn);
    assert(unanchored.isNote(), 'Answer without reliable source becomes native child note');
    let entries = await app.readingNotes.list(reader.itemID);
    const saved = entries.find((entry) => entry.id === unanchored.id);
    assert(saved?.comment === '回答片段' && !saved.position, 'Unanchored note appears in list');
    await app.readingNotes.update(saved, '编辑后的独立笔记');
    const stale = entries.find((entry) => entry.id === item.id);
    item.annotationComment = '其他位置修改';
    await item.saveTx();
    let rejected = false;
    try {
      await app.readingNotes.update(stale, '旧编辑内容');
    } catch {
      rejected = true;
    }
    assert(
      rejected && item.annotationComment === '其他位置修改',
      'Concurrent native edit is preserved',
    );
    const keys = entries.map((entry) => entry.key);
    for (const entry of entries) await app.readingNotes.remove(entry);
    await until(
      () => !reader._internalReader._state.annotations.some((entry) => keys.includes(entry.id)),
      'Deleted highlights disappear from native PDF',
      10000,
    );
    entries = await app.readingNotes.list(reader.itemID);
    assert(entries.length === 0, 'Removed notes leave the shared list');
    report.storageScope =
      'Native persistence and callbacks with explicit synthetic answer/translation';
    await persist();
  });
}
