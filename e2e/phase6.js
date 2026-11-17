import { setLayout, saveWindow } from './screenshots.js';
import { createSelectionControls } from './selection.js';

export async function runPhase6(context) {
  const {
    environment,
    config,
    window,
    panel,
    reader,
    report,
    until,
    wait,
    assert,
    readSession,
    persist,
    case_,
    click,
  } = context;
  const { IOUtils, PathUtils } = environment;
  let sequence = 0;
  const screenshot = async (name, targetWindow = window) => {
    const filename = `${name}.png`;
    const image = await saveWindow(
      environment,
      targetWindow,
      PathUtils.join(config.runDirectory, 'screenshots', filename),
    );
    report.screenshots.push({
      name,
      filename,
      ...image,
      panelRect: {
        left: panel.getBoundingClientRect().left,
        top: panel.getBoundingClientRect().top,
        width: panel.getBoundingClientRect().width,
        height: panel.getBoundingClientRect().height,
      },
      requested: {
        theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        width: 380,
      },
    });
    await persist();
  };
  const ask = async (question) => {
    const count = (await readSession()).turns.length;
    const input = panel.querySelector('textarea');
    input.value = question;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    click(panel, '发送');
    const turn = await until(async () => {
      const turns = (await readSession()).turns;
      const last = turns.at(-1);
      if (turns.length <= count) return null;
      if (last.state === 'failed') throw new Error(JSON.stringify(last.error));
      return ['complete', 'needs-review'].includes(last.state) ? last : null;
    }, question);
    await IOUtils.writeJSON(PathUtils.join(config.runDirectory, `turn-${++sequence}.json`), turn);
    await wait(400);
    return turn;
  };
  const tail = config.only === 'phase6-tail';
  report.scope = tail
    ? 'phase6-nine-step-completion'
    : config.only === 'phase6-full'
      ? 'phase6-nine-step'
      : 'phase6-step1';
  await setLayout(environment, window, panel, { theme: 'light', width: 380 }, wait);
  if (!tail) {
    await case_('新用户第一眼与真实模型菜单', async () => {
      await until(
        () => !panel.classList.contains('rc-setup-active'),
        'Existing account checked and chat visible',
      );
      await screenshot('empty');
      panel.querySelector('.rc-model-button').click();
      await until(
        () => panel.querySelectorAll('.rc-model-option').length > 1,
        'Live model catalog',
      );
      await screenshot('model-menu');
      const choice = [...panel.querySelectorAll('.rc-model-option')].find((node) =>
        /GPT-6 Sol|gpt-6-sol/iu.test(node.textContent),
      );
      assert(choice, 'Local model catalog includes the selected model');
      choice.click();
      panel.querySelector('.rc-model-button').click();
      const effort = [...panel.querySelectorAll('.rc-efforts button')].find(
        (node) => node.textContent === '快',
      );
      if (effort) effort.click();
      else panel.querySelector('.rc-model-button').click();
    });
    await case_('当前页提问、模型与对话持久化', async () => {
      const turn = await ask('这里的 assert 是什么意思？简短回答。');
      assert(turn.provider.model === 'gpt-6-sol', 'Chosen model reached the actual request');
      assert(turn.snapshot.pageIndex === 0, 'Question carries the displayed page');
      await screenshot('conversation');
    });
    const selection = createSelectionControls(context);
    await case_('选句翻译、引用提问与回到原文', async () => {
      const sentence = 'The source shall not change DATA for 3 cycles.';
      await selection.translated(sentence);
      await screenshot('sentence-popup');
      click(selection.root(), '引用');
      await until(
        () => panel.querySelector('.rc-quote-text')?.textContent === sentence,
        'Quoted sentence in composer',
      );
      await screenshot('quoted-composer');
      const turn = await ask('解释引用这句话的限制。');
      assert(
        turn.sentEvidence.references[0].text === sentence &&
          turn.sentEvidence.references[0].pageIndex === 0 &&
          turn.sentEvidence.references[0].position.rects.length,
        'Original quoted text, page and coordinates reached the model',
      );
      panel.querySelector('.rc-turn:last-child .rc-cite-block').click();
      await wait(300);
      assert(
        reader._internalReader._primaryView._iframeWindow.PDFViewerApplication.pdfViewer
          .currentPageNumber === 1,
        'Quoted block navigates to its original page',
      );
      await screenshot('quoted-answer');
    });
  }
  if (config.only === 'phase6-full' || tail) {
    if (!tail) {
      await case_('切换另一模型再问', async () => {
        panel.querySelector('.rc-model-button').click();
        await until(() => panel.querySelector('.rc-model-option'), 'Model menu');
        const model = [...panel.querySelectorAll('.rc-model-option')].find(
          (node) => node.getAttribute('aria-checked') !== 'true',
        );
        assert(model, 'Alternative model is actually available');
        model.click();
        panel.querySelector('.rc-model-button').click();
        const effort = [...panel.querySelectorAll('.rc-efforts button')].find(
          (node) => node.textContent === '快',
        );
        if (effort) effort.click();
        else panel.querySelector('.rc-model-button').click();
        const turn = await ask('请用一句话解释 assert。');
        const chosen = JSON.parse(
          environment.Zotero.Prefs.get('extensions.readingCompanion.chatModel.v1', true),
        );
        assert(
          turn.provider.model === chosen.model && chosen.model !== 'gpt-6-sol',
          'New question used the newly selected model',
        );
      });
      const specificationReader = await context.open(context.specification, 2);
      await case_('直接问当前页、追问、翻页再问', async () => {
        panel.querySelector('.rc-page-chip').click();
        const first = await ask('第三拍为什么不能换数据？');
        assert(first.snapshot.pageIndex === 2, 'Initial question uses page 3');
        await specificationReader.navigate({ pageIndex: 4 });
        await wait(800);
        const follow = await ask('为什么？');
        assert(follow.snapshot.pageIndex === 2, 'Follow-up retains the page shown as inherited');
        panel.querySelector('.rc-page-chip').click();
        const changed = await ask('现在这一页第三拍能换数据吗？');
        assert(changed.snapshot.pageIndex === 4, 'Clicking page chip switches to current page 5');
        await screenshot('page-follow-up');
      });
      await case_('翻译本页与逐句追问', async () => {
        await specificationReader.navigate({ pageIndex: 5 });
        await wait(800);
        const count = (await readSession()).turns.length;
        click(panel, '快捷');
        click(panel, '翻译这一页');
        const turn = await until(async () => {
          const turns = (await readSession()).turns;
          const last = turns.at(-1);
          if (turns.length <= count) return null;
          if (last.state === 'failed') throw new Error(JSON.stringify(last.error));
          return last.answer?.translation ? last : null;
        }, 'Page translation');
        await IOUtils.writeJSON(PathUtils.join(config.runDirectory, 'page-translation.json'), turn);
        assert(
          turn.displayQuestion === '翻译本页',
          'User sees the clicked action instead of prompt',
        );
        await wait(500);
        await screenshot('page-translation');
        panel.querySelector('.rc-turn:last-child .rc-translation-ask').click();
        await ask(panel.querySelector('textarea').value);
      });
    }
    await case_('整理笔记、修改、保存与原生编辑器', async () => {
      const app = environment.Zotero['reading-companion@local'];
      const source = (await readSession()).turns.find((turn) => turn.answer?.claims?.length);
      await app.readingNotes.saveAnswer(source);
      click(panel, '快捷');
      click(panel, '整理成笔记');
      await until(() => {
        const button = [...panel.querySelectorAll('button')].find(
          (node) => node.textContent === '生成笔记',
        );
        return button && !button.disabled;
      }, 'Notebook ready');
      const previousDraft = (await readSession()).notebookDraft?.generatedAt;
      click(panel, '生成笔记');
      const first = await until(async () => {
        const draft = (await readSession()).notebookDraft;
        return draft && draft.generatedAt !== previousDraft ? draft : null;
      }, 'Notebook generated');
      await screenshot('notebook-preview');
      const input = panel.querySelector('textarea');
      input.value = '再简短一点，保留关键条件和出处。';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await until(() => {
        const send = panel.querySelector('button[aria-label="发送"]');
        return send.getClientRects().length && !send.disabled;
      }, 'Notebook input ready for revision');
      click(panel, '发送');
      await until(
        async () => (await readSession()).notebookDraft?.generatedAt !== first.generatedAt,
        'Notebook revised',
      );
      click(panel, '新建子笔记');
      const noteID = await until(
        async () => (await readSession()).notebookNoteID,
        'Notebook saved',
      );
      const note = environment.Zotero.Items.get(noteID);
      assert(note.parentID === context.specification.parentID, 'Saved under the correct paper');
      await IOUtils.writeUTF8(
        PathUtils.join(config.runDirectory, 'notebook-body.html'),
        note.getNote(),
      );
      click(panel, '打开笔记');
      const editorWindow = await until(
        () =>
          [...environment.Services.wm.getEnumerator(null)].find(
            (entry) => entry !== window && entry.document.querySelector('note-editor'),
          ),
        'Native note editor',
      );
      await until(
        () =>
          editorWindow.document
            .querySelector('note-editor')
            ._iframe?.contentDocument?.querySelector('.ProseMirror')?.textContent,
        'Native note body',
      );
      await screenshot('notebook-native', editorWindow);
      editorWindow.close();
      window.focus();
      click(panel, '继续阅读');
    });
    await case_('设置与术语表', async () => {
      click(panel, '更多');
      click(panel, '本篇术语表');
      await screenshot('glossary');
      click(panel, '收起术语表');
      click(panel, '更多');
      click(panel, '模型设置');
      const preferences = await until(
        () =>
          [...environment.Services.wm.getEnumerator('zotero:pref')].find((entry) =>
            entry.document.querySelector('.rc-settings'),
          ),
        'Settings window',
      );
      const settings = preferences.document.querySelector('.rc-settings');
      settings.querySelector('.rc-provider-row').click();
      await until(
        () =>
          [...settings.querySelectorAll('label')]
            .find((label) => label.firstChild.textContent === '模型')
            ?.querySelectorAll('option').length > 1,
        'Settings model dropdown',
      );
      await screenshot('settings', preferences);
      preferences.close();
      window.focus();
    });
  }
  await case_('新对话与找回历史', async () => {
    const previousCount = (await readSession()).turns.length;
    click(panel, '新对话');
    await until(async () => !(await readSession()).turns.length, 'New conversation saved');
    click(panel, '历史对话');
    await screenshot('history');
    panel.querySelector('.rc-history-row button').click();
    await until(
      async () => (await readSession()).turns.length === previousCount,
      'History restored',
    );
    await setLayout(environment, window, panel, { theme: 'dark', width: 380 }, wait);
    await screenshot('dark-overview');
    const session = await readSession();
    await IOUtils.writeJSON(PathUtils.join(config.runDirectory, 'continuity.json'), {
      documentId: session.documentId,
      count: session.turns.length,
      first: session.turns[0].id,
    });
  });
}
