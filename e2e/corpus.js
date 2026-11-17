import { layouts, saveWindow } from './screenshots.js';
import { createSelectionControls } from './selection.js';

export async function runCorpusAcceptance(context) {
  const { environment, config, report, until, assert, case_, wait } = context;
  const { Zotero, IOUtils, PathUtils } = environment;
  report.scope = 'cross-disciplinary';
  report.corpus = config.corpus;
  const checks = {
    medicine: /区间|误差|须线|须状/u,
    social: /回归/u,
    humanities: /权利|隐私权/u,
    math: /基底|基向量|正交基|基[；;，,（(]|基$/u,
    german: /不可侵犯|不容侵犯/u,
  };
  for (let index = 0; index < config.corpus.length; index++) {
    const material = config.corpus[index];
    const attachment = context.attachments[index];
    await context.open(attachment, material.pageIndex);
    const reader = context.getReader();
    const panel = context.getPanel();
    const window = context.window;
    const local = { ...context, reader, panel };
    const selection = createSelectionControls(local);
    const click = (label) => {
      const button = [...panel.querySelectorAll('button')].find(
        (node) => node.textContent.trim() === label || node.getAttribute('aria-label') === label,
      );
      assert(button && !button.disabled, `${material.id}: control ${label}`);
      button.click();
    };
    await case_(`${material.id}-current-page`, async () => {
      assert(
        (await context.readSession()).turns.length === 0,
        'New literature starts independently',
      );
      const response = await context.submit(
        `${material.id}-current`,
        material.question,
        'ask',
        layouts[0],
      );
      assert(!response.evidence.selection, 'Current-page question has no selected text');
      assert(
        response.evidence.images.some((image) => image.pageIndex === material.pageIndex),
        'Current-page image is actually sent',
      );
      assert(response.evidence.pageIndex === material.pageIndex, 'Current-page evidence is fixed');
      await context.shot(`${material.id}-answer`, layouts[0]);
      return response.evidence;
    });
    await case_(`${material.id}-follow-up`, async () => {
      const response = await context.submit(
        `${material.id}-followup`,
        material.followup,
        'ask',
        layouts[0],
      );
      assert(
        response.evidence.pageIndex === material.pageIndex,
        'Follow-up preserves paper and page',
      );
      return response.evidence;
    });
    await case_(`${material.id}-paragraph-translation`, async () => {
      await selection.select(material.translationStart, true, material.translationEnd);
      const response = await context.submit(
        `${material.id}-translation`,
        '',
        'translate-selection',
        layouts[0],
      );
      assert(
        response.turn.snapshot.selection?.text.length > 40,
        'A real passage, not only the dictionary term, is translated',
      );
      assert(
        response.turn.answer.translation.rows.length > 0,
        'Structured passage translation exists',
      );
      await context.shot(`${material.id}-translation`, layouts[1]);
      return response.evidence;
    });
    await case_(`${material.id}-contextual-term`, async () => {
      const response = await selection.translated(material.term);
      assert(
        checks[material.id].test(response.translation.split(/[；;\n]/u)[0]),
        'Dictionary first meaning belongs to the current discipline',
      );
      const before = attachment.getAnnotations().length;
      selection.root().closest('.selection-popup').querySelector('.color-button').click();
      await until(
        () => attachment.getAnnotations().length === before + 1,
        'Domain term highlighted natively',
        10000,
      );
      await until(
        () =>
          attachment
            .getAnnotations()
            .some((item) => item.annotationComment === response.translation),
        'Domain translation saved in annotation',
        10000,
      );
      await IOUtils.writeJSON(
        PathUtils.join(config.runDirectory, `${material.id}-term.json`),
        response,
      );
      return response;
    });
    await case_(`${material.id}-notebook`, async () => {
      click('更多');
      click('整理成笔记');
      await until(
        () =>
          [...panel.querySelectorAll('.rc-notebook button')].find(
            (node) => node.textContent === '生成笔记' && !node.disabled,
          ),
        'Notebook coverage prepared',
      );
      click('生成笔记');
      const draft = await until(
        async () => (await context.readSession()).notebookDraft,
        `${material.id}: real notebook synthesis`,
        240000,
      );
      click('新建子笔记');
      const id = await until(
        async () => (await context.readSession()).notebookNoteID,
        'Domain notebook saved',
      );
      const note = Zotero.Items.get(id);
      assert(note.parentID === attachment.parentID, 'Domain note has the correct parent');
      const parsed = new window.DOMParser().parseFromString(note.getNote(), 'text/html');
      const links = [...parsed.querySelectorAll('a')];
      assert(
        links.length &&
          links.every((link) =>
            link.getAttribute('href').includes(`/items/${attachment.key}?page=`),
          ),
        'Every saved source link belongs to this literature',
      );
      const sourceIDs = new Set(draft.material.sources.map((source) => source.id));
      assert(
        draft.sections.every((section) =>
          section.points.every(
            (point) =>
              point.sources.length && point.sources.every((source) => sourceIDs.has(source)),
          ),
        ),
        'All domain notebook points retain actual source references',
      );
      await IOUtils.writeJSON(
        PathUtils.join(config.runDirectory, `${material.id}-notebook.json`),
        draft,
      );
      await IOUtils.writeUTF8(
        PathUtils.join(config.runDirectory, `${material.id}-note.html`),
        note.getNote(),
      );
      await context.shot(`${material.id}-notebook`, layouts[1]);
      if (material.id === 'math') {
        click('打开笔记');
        const editorWindow = await until(
          () =>
            [...environment.Services.wm.getEnumerator(null)].find(
              (entry) => entry !== window && entry.document.querySelector('note-editor'),
            ),
          'Mathematical notebook in native editor',
        );
        const editor = editorWindow.document.querySelector('note-editor');
        const body = await until(
          () => editor._iframe?.contentDocument?.querySelector('.ProseMirror'),
          'Mathematical note DOM',
        );
        await until(
          () => body.querySelectorAll('.katex').length > 2,
          'Multiple actual PCA formulas rendered',
        );
        assert(
          !body.querySelector('.katex-error'),
          'Native editor reports no formula rendering errors',
        );
        editorWindow.browsingContext.prefersColorSchemeOverride = 'light';
        editorWindow.resizeTo(1000, 850);
        await wait(300);
        (body.querySelector('math-display') || body.querySelector('.katex')).scrollIntoView({
          block: 'center',
        });
        const filename = 'math-native-editor.png';
        const image = await saveWindow(
          environment,
          editorWindow,
          PathUtils.join(config.runDirectory, 'screenshots', filename),
        );
        report.screenshots.push({
          name: 'math-native-editor',
          filename,
          requested: { theme: 'light', width: 1000 },
          ...image,
        });
        await IOUtils.writeUTF8(
          PathUtils.join(config.runDirectory, 'math-native-editor.html'),
          body.innerHTML,
        );
        editorWindow.close();
        window.focus();
      }
      click('继续阅读');
      await wait(100);
      return {
        noteID: id,
        coverage: draft.material.coverage,
        points: draft.sections.reduce((sum, section) => sum + section.points.length, 0),
      };
    });
  }
}
