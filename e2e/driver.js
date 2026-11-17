import { runModelChat } from './model-chat.js';
import { runPhase10 } from './phase10.js';
import { runReadingNotes, runNoteStorage } from './phase9-notes.js';
import { runPhase9UI } from './phase9-ui.js';
import { runRedesign } from './redesign.js';
import { runLongText } from './phase9-long.js';
import { runRealLogin } from './real-login.js';
import { runPhase6 } from './phase6.js';
import { layouts, setLayout, saveWindow, hashBytes } from './screenshots.js';
import { runSelectionAcceptance, createSelectionControls } from './selection.js';
import { runSetupAcceptance } from './phase7-setup.js';
import { runCorpusAcceptance } from './corpus.js';
import { runModelEmptyAcceptance, runScanEmptyAcceptance } from './empty.js';
import { saveDiagnostics } from './diagnostics.js';

export async function runAcceptance(environment, config) {
  const { Zotero, IOUtils, PathUtils, Services, Components, ChromeUtils } = environment;
  const wait = (milliseconds) => Zotero.Promise.delay(milliseconds);
  const reportPath = PathUtils.join(config.runDirectory, 'report.json');
  const report = {
    started: new Date().toISOString(),
    checksum: config.checksum,
    status: 'running',
    scope: 'full',
    cases: [],
    screenshots: [],
    assertions: [],
  };
  let persistence = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.parse(JSON.stringify(report));
    persistence = persistence.then(() =>
      IOUtils.writeJSON(reportPath, snapshot, { tmpPath: reportPath + '.tmp' }),
    );
    return persistence;
  };
  const diagnose = async (label, error) => {
    try {
      const file = await saveDiagnostics(environment, config, label, error);
      (report.diagnostics ||= []).push(file);
    } catch (failure) {
      (report.diagnosticFailures ||= []).push(String(failure));
    }
    await persist();
  };
  const assert = (condition, name, details = {}) => {
    report.assertions.push({ name, passed: Boolean(condition), ...details });
    if (!condition) throw new Error(name);
  };
  const until = async (predicate, label, timeout = 180000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (stopping) throw new Error('Acceptance interrupted');
      const result = await predicate();
      if (result) return result;
      await wait(100);
    }
    const error = new Error(`Timed out: ${label}`);
    await diagnose(label, error);
    throw error;
  };
  let window;
  let panel;
  let reader;
  let currentAttachment;
  let stopTimer;
  let stopping = false;
  let stoppingDiagnostic;
  const scrollObservers = new Map();
  const inputListeners = new Map();
  let automatedPointer = false;
  const observeInput = (targetWindow) => {
    if (!targetWindow || inputListeners.has(targetWindow)) return;
    const handler = (event) => {
      if (!event.isTrusted) return;
      (report.inputEvents ||= []).push({
        type: event.type,
        time: Date.now(),
        automatedPointer,
        target: event.target?.localName,
        id: event.target?.id,
        class: String(event.target?.className || ''),
        deltaY: event.deltaY,
        clientX: event.clientX,
        clientY: event.clientY,
        buttons: event.buttons,
        key: event.key?.length === 1 ? 'character' : event.key,
      });
      report.inputEvents = report.inputEvents.slice(-120);
    };
    for (const type of ['wheel', 'pointerdown', 'keydown']) {
      targetWindow.addEventListener(type, handler, { capture: true, passive: true });
    }
    inputListeners.set(targetWindow, handler);
  };
  const case_ = async (name, operation) => {
    if (stopping) throw new Error('Acceptance interrupted');
    const firstAssertion = report.assertions.length;
    const entry = { name, started: new Date().toISOString(), state: 'running' };
    report.cases.push(entry);
    await persist();
    try {
      entry.result = await operation();
      entry.state = report.assertions.slice(firstAssertion).some((entry) => !entry.passed)
        ? 'failed'
        : 'passed';
    } catch (error) {
      entry.state = 'failed';
      entry.error = String(error.message || error).slice(0, 600);
      if (!stopping) await diagnose(name, error);
    }
    await persist();
    if (stopping) throw new Error('Acceptance interrupted');
    if (config.failFast && entry.state === 'failed') throw new Error(`Failed case: ${name}`);
    return entry.result;
  };
  const click = (root, label) => {
    const button = [...root.querySelectorAll('button')].find((node) => {
      return (
        node.getClientRects().length &&
        (node.textContent.trim() === label || node.getAttribute('aria-label') === label)
      );
    });
    assert(button && !button.disabled, `Enabled UI control: ${label}`);
    button.scrollIntoView({ block: 'nearest' });
    button.focus({ preventScroll: true });
    button.click();
  };
  const field = (root, label) => {
    return [...root.querySelectorAll('label')]
      .find((node) => {
        return node.querySelector('span')?.textContent.trim() === label;
      })
      ?.querySelector('input,select');
  };
  const change = (control, value) => {
    assert(control, `UI field available: ${value}`);
    control.value = value;
    control.dispatchEvent(new control.ownerDocument.defaultView.Event('change', { bubbles: true }));
  };
  const pdf = () =>
    (reader._internalReader._lastView || reader._internalReader._primaryView)._iframeWindow
      .PDFViewerApplication;
  const currentPage = () => pdf().pdfViewer.currentPageNumber - 1;
  const readSession = async () => {
    const path = PathUtils.join(
      config.data,
      'reading-companion',
      `session-${currentAttachment.libraryID}-${currentAttachment.key}.json`,
    );
    try {
      return await IOUtils.readJSON(path);
    } catch {
      return { turns: [] };
    }
  };
  const recordEvidence = (turn) => {
    const sent = turn.sentEvidence;
    assert(sent?.id === turn.snapshot.id, 'Persisted payload identifies the exact snapshot');
    const images = sent.images.map((metadata) => {
      const image = turn.snapshot.images.find((candidate) => {
        return (
          candidate.pageIndex === metadata.pageIndex &&
          candidate.width === metadata.width &&
          candidate.height === metadata.height
        );
      });
      assert(image, 'Sent image resolves to the frozen pixel data');
      const bytes = Uint8Array.from(environment.atob(image.dataURL.split(',')[1]), (character) =>
        character.charCodeAt(0),
      );
      return { ...metadata, sha256: hashBytes(environment, bytes) };
    });
    return {
      snapshotId: sent.id,
      document: sent.document,
      pageIndex: sent.pageIndex,
      printedPage: sent.printedPage,
      selection: sent.selection,
      hasSelection: Boolean(sent.selection),
      decision: sent.decision,
      images,
      sources: sent.sources,
      question: turn.question,
      state: turn.state,
      answer: turn.answer,
      provider: turn.provider,
    };
  };
  const shot = async (name, layout, targetWindow = window, targetPanel = panel) => {
    const dimensions = await setLayout(environment, targetWindow, targetPanel, layout, wait);
    const conversation = targetPanel.querySelector('.rc-conversation');
    const lastTurn = conversation?.querySelector('.rc-turn:last-child');
    const focus =
      name === 'answer-with-citations'
        ? lastTurn?.querySelector('.rc-claim')
        : name === 'timing-table'
          ? lastTurn?.querySelector('.rc-table-scroll')
          : name === 'translation'
            ? [...(lastTurn?.querySelectorAll('.rc-translation') || [])].find((node) =>
                node.textContent.includes('Offset'),
              )
            : null;
    if (focus) {
      conversation.scrollTop +=
        focus.getBoundingClientRect().top - conversation.getBoundingClientRect().top;
      await wait(150);
    }
    if (name === 'latest-position') {
      conversation.scrollTop = 0;
      conversation.dispatchEvent(new targetWindow.Event('scroll'));
      await wait(100);
      const latest = targetPanel.querySelector('.rc-latest');
      assert(!latest.hidden, 'Latest navigation appears after scrolling away');
      assert(
        latest.getBoundingClientRect().top >= conversation.getBoundingClientRect().bottom,
        'Latest navigation occupies its own space below content',
      );
    }
    const filename = `${name}-${layout.theme}-${layout.width}.png`;
    const path = PathUtils.join(config.runDirectory, 'screenshots', filename);
    const image = await saveWindow(environment, targetWindow, path);
    const last = (await readSession()).turns.at(-1);
    report.screenshots.push({
      name,
      filename,
      ...image,
      ...dimensions,
      modelSnapshotId: last?.sentEvidence?.id || null,
      documentKey: currentAttachment.key,
      currentPage: currentPage(),
    });
    await persist();
    assert(
      Math.abs(dimensions.width - layout.width) < 3,
      `Viewport width: ${filename}`,
      dimensions,
    );
    assert(dimensions.dark === (layout.theme === 'dark'), `Native theme: ${filename}`);
    assert(
      dimensions.scrollWidth <= dimensions.clientWidth + 2,
      `No horizontal overflow: ${filename}`,
    );
    for (const [role, sample] of Object.entries(dimensions.styleAudit)) {
      // The primary control is an icon-only send button, which needs the 3:1 graphics ratio.
      const minimum = role === 'primary' ? 3 : 4.5;
      assert(sample.contrast >= minimum, `Text contrast: ${filename}/${role}`, sample);
    }
  };
  const matrix = async (name, targetWindow = window, targetPanel = panel) => {
    for (const layout of layouts) {
      try {
        await shot(name, layout, targetWindow, targetPanel);
      } catch (error) {
        await diagnose(`screenshot-${name}`, error);
        report.assertions.push({
          name: `Screenshot: ${name}/${layout.theme}/${layout.width}`,
          passed: false,
          error: String(error.message || error).slice(0, 400),
        });
        await persist();
      }
    }
  };
  const open = async (attachment, pageIndex) => {
    currentAttachment = attachment;
    reader = await Zotero.Reader.open(attachment.id, { pageIndex });
    await reader._initPromise;
    await until(
      () => {
        return reader._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication
          ?.pdfDocument;
      },
      'PDF document',
      30000,
    );
    window.ZoteroContextPane.collapsed = false;
    await reader.navigate({ pageIndex });
    pdf().pdfViewer.currentScaleValue = 'page-fit';
    await until(
      () => {
        panel = window.document.querySelector('.rc-workspace:not([hidden]) .rc-panel');
        if (panel) return panel.isConnected;
        const deck = window.document.querySelector('#zotero-context-pane-item-deck')?.selectedPanel;
        const section = deck?.querySelector(
          'item-pane-custom-section[data-pane*="reading-companion"]',
        );
        if (section?._section) section._section.open = true;
        const entry = section?.querySelector('[data-rc-open-workspace]');
        if (entry) entry.click();
        return false;
      },
      'Product sidebar',
      20000,
    );
    await wait(900);
    await reader.navigate({ pageIndex });
    await until(() => currentPage() === pageIndex, 'Requested page after layout settled', 10000);
    assert(currentPage() === pageIndex, 'Reader opened requested file page');
    observeInput(window);
    observeInput(Components.utils.unwaiveXrays(reader._iframeWindow));
    const activeView = reader._internalReader._lastView || reader._internalReader._primaryView;
    observeInput(Components.utils.unwaiveXrays(activeView._iframeWindow));
    const conversation = panel.querySelector('.rc-conversation');
    if (!scrollObservers.has(conversation)) {
      const record = (event) => {
        const last = conversation.lastElementChild;
        const box = conversation.getBoundingClientRect();
        (report.scrollTransitions ||= []).push({
          event,
          time: Date.now(),
          top: conversation.scrollTop,
          height: conversation.scrollHeight,
          clientHeight: conversation.clientHeight,
          viewportTop: box.top,
          lastTurn: last?.dataset.turnId,
          lastTop: last?.getBoundingClientRect().top,
          focused: window.document.activeElement?.localName,
          focusedClass: String(window.document.activeElement?.className || ''),
        });
        report.scrollTransitions = report.scrollTransitions.slice(-120);
      };
      const observer = new window.MutationObserver(() => {
        record('round-inserted');
        window.requestAnimationFrame(() => record('next-frame'));
      });
      observer.observe(conversation, { childList: true });
      scrollObservers.set(conversation, observer);
    }
    return reader;
  };
  const submit = async (name, question, purpose, layout, flipTo, evidenceChoice) => {
    await setLayout(environment, window, panel, layout, wait);
    const options = panel.querySelector('.rc-options');
    if (options) options.hidden = false;
    change(field(panel, '用途'), purpose);
    change(field(panel, '依据选择'), 'auto');
    if (options) options.hidden = true;
    const count = (await readSession()).turns.length;
    const input = panel.querySelector('textarea');
    input.focus();
    input.value = question;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    if (purpose === 'ask') {
      const view = reader._internalReader._lastView || reader._internalReader._primaryView;
      assert(
        !(view._selectionRanges || []).some((range) => !range.collapsed),
        `No selection before native ask: ${name}`,
      );
    }
    click(panel, '发送');
    if (evidenceChoice) {
      const choice = await until(
        () => panel.querySelector('.rc-choice:not([hidden])'),
        'Inline evidence choice',
        10000,
      );
      assert((await readSession()).turns.length === count, 'No model turn before evidence choice');
      await matrix('evidence-choice');
      await setLayout(environment, window, panel, layout, wait);
      await reader.navigate({ pageIndex: 0 });
      choice.querySelector(`[data-rc-evidence-choice="${evidenceChoice}"]`).click();
    }
    if (flipTo !== undefined) await reader.navigate({ pageIndex: flipTo });
    let streamed = false;
    const turn = await until(
      async () => {
        const article = [...panel.querySelectorAll('.rc-turn')][count];
        if (!streamed && article?.querySelector('.rc-stream')?.textContent.trim()) {
          streamed = true;
          const streamBox = article.querySelector('.rc-stream').getBoundingClientRect();
          const conversationBox = panel.querySelector('.rc-conversation').getBoundingClientRect();
          assert(
            streamBox.bottom > conversationBox.top && streamBox.top < conversationBox.bottom,
            `Streaming text is visible in the answer viewport: ${name}`,
          );
          // Capture this actual streaming frame immediately, without changing layout mid-frame.
          const filename = `${name}-streaming-${layout.theme}-${layout.width}.png`;
          const path = PathUtils.join(config.runDirectory, 'screenshots', filename);
          const image = await saveWindow(environment, window, path);
          report.screenshots.push({
            name: 'streaming',
            filename,
            ...image,
            requested: layout,
            width: panel.getBoundingClientRect().width,
            dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
            modelSnapshotId: (await readSession()).turns[count]?.snapshot.id,
          });
          assert(
            Math.abs(panel.getBoundingClientRect().width - layout.width) < 3,
            `Streaming width: ${name}`,
          );
          assert(
            window.matchMedia('(prefers-color-scheme: dark)').matches === (layout.theme === 'dark'),
            `Streaming theme: ${name}`,
          );
        }
        const record = (await readSession()).turns[count];
        if (record && ['complete', 'needs-review', 'failed', 'cancelled'].includes(record.state)) {
          return record;
        }
        const message = panel.querySelector('.rc-status')?.textContent || '';
        if (!record && /提取失败|尺寸无法读取|连接失败|未找到|尚未就绪/u.test(message)) {
          throw new Error(message);
        }
        return null;
      },
      `Answer: ${name}`,
      210000,
    );
    const evidence = turn.sentEvidence ? recordEvidence(turn) : { error: turn.error };
    await IOUtils.writeJSON(PathUtils.join(config.runDirectory, `${name}-evidence.json`), evidence);
    if (turn.answer) {
      await IOUtils.writeUTF8(
        PathUtils.join(config.runDirectory, `${name}-answer.md`),
        turn.answer.text,
      );
      if (turn.answer.translation) {
        await IOUtils.writeJSON(
          PathUtils.join(config.runDirectory, `${name}-translation.json`),
          turn.answer.translation,
        );
      }
    }
    assert(Boolean(turn.answer), `Completed model answer: ${name}`, { error: turn.error });
    assert(streamed, `Observed actual streamed answer text: ${name}`);
    return { turn, evidence };
  };

  const selectText = async () => {
    const view = reader._internalReader._lastView || reader._internalReader._primaryView;
    const frame = view._iframeWindow;
    const span = await until(
      () =>
        [...frame.document.querySelectorAll('.textLayer span')].find((node) =>
          node.textContent.includes('Branches chose'),
        ),
      'PDF text span',
      10000,
    );
    const rectangle = span.getBoundingClientRect();
    const utilities = Components.utils.unwaiveXrays(frame).windowUtils;
    const start = rectangle.left + 2;
    const end = rectangle.right - 2;
    const vertical = rectangle.top + rectangle.height / 2;
    automatedPointer = true;
    utilities.sendMouseEvent('mousedown', start, vertical, 0, 1, 0);
    for (let index = 1; index <= 8; index++) {
      utilities.sendMouseEvent('mousemove', start + ((end - start) * index) / 8, vertical, 0, 0, 0);
      await wait(20);
    }
    utilities.sendMouseEvent('mouseup', end, vertical, 0, 1, 0);
    automatedPointer = false;
    await until(
      () => view._selectionRanges.some((range) => !range.collapsed && range.text),
      'Real reader selection',
      10000,
    );
    await matrix('selected');
    return {
      pageIndex: currentPage(),
      selection: view._selectionRanges
        .filter((range) => !range.collapsed)
        .map((range) => ({
          text: range.text,
          position: JSON.parse(JSON.stringify(range.position)),
        })),
    };
  };

  try {
    await persist();
    assert(Zotero.DataDirectory.dir === config.data, 'Isolated data directory');
    await Zotero.uiReadyPromise;
    await Zotero.Libraries.userLibrary.waitForDataLoad('item');
    window = await until(() => Zotero.getMainWindow(), 'Main window', 20000);
    stopTimer = window.setInterval(async () => {
      if (stopping || !(await IOUtils.exists(PathUtils.join(config.runDirectory, 'stop-request'))))
        return;
      stopping = true;
      report.fatal = 'Launcher requested stop (timeout or interruption)';
      report.status = 'failed';
      stoppingDiagnostic = diagnose('launcher-stop', new Error(report.fatal));
    }, 500);
    window.resizeTo(1400, 1100);
    window.focus();
    const { AddonManager } = ChromeUtils.importESModule(
      'resource://gre/modules/AddonManager.sys.mjs',
    );
    const addon = await until(
      async () => {
        const installed = await AddonManager.getAddonByID('reading-companion@local');
        return installed?.isActive ? installed : null;
      },
      'Original XPI active',
      30000,
    );
    report.installation = {
      version: addon.version,
      active: addon.isActive,
      compatible: addon.isCompatible,
      zoteroVersion: Zotero.version,
    };
    assert(Zotero.Server.port === config.port, 'Isolated HTTP port');
    if (config.legacySessions?.length) {
      await case_('覆盖升级保留旧会话、术语表和配置', async () => {
        const product = Zotero['reading-companion@local'];
        for (const previous of config.legacySessions) {
          const loaded = await product.store.session(previous.documentId);
          assert(
            JSON.stringify(loaded.turns.map((turn) => turn.id)) ===
              JSON.stringify(previous.turns) &&
              JSON.stringify(loaded.glossary) === JSON.stringify(previous.glossary),
            'Existing conversation and glossary preserved: ' + previous.documentId,
          );
        }
        if (config.inheritedConfiguration)
          assert(
            JSON.stringify(product.store.configuration()) === config.inheritedConfiguration,
            'Existing provider settings preserved',
          );
      });
    }
    if (config.only === 'phase6-tail') {
      const [libraryID, key] = config.continuity.documentId.split('-');
      const specification = Zotero.Items.getByLibraryAndKey(Number(libraryID), key);
      await open(specification, 5);
      await runPhase6({
        environment,
        config,
        report,
        window,
        reader,
        panel,
        wait,
        until,
        assert,
        case_,
        readSession,
        persist,
        click,
        open,
        specification,
      });
      return;
    }
    if (['phase6-restart', 'phase6-math-view'].includes(config.only)) {
      report.scope = 'phase6-restart';
      const saved = config.continuity;
      const [libraryID, key] = saved.documentId.split('-');
      const attachment = Zotero.Items.getByLibraryAndKey(Number(libraryID), key);
      await open(attachment, config.only === 'phase6-math-view' ? 5 : 0);
      await case_('重开 Zotero 与侧栏，对话仍在', async () => {
        const session = await readSession();
        assert(
          session.turns.length === saved.count && session.turns[0].id === saved.first,
          'Conversation retained after actual process restart',
        );
        click(panel, '更多');
        click(panel, '关闭侧栏');
        const entry = reader._iframeWindow.document.querySelector('[data-rc-open-workspace]');
        assert(entry, 'Reader toolbar entry remains available');
        entry.click();
        await wait(500);
        assert(
          panel.querySelectorAll('.rc-turn').length === saved.count,
          'Reopened sidebar restores turns',
        );
        await shot(config.only === 'phase6-math-view' ? 'math-answer' : 'reopened-conversation', {
          theme: 'light',
          width: 380,
        });
        if (config.only === 'phase6-math-view') {
          const input = panel.querySelector('textarea');
          input.value = '继续解释这个等式';
          input.dispatchEvent(new window.Event('input', { bubbles: true }));
          await wait(800);
          await shot('ready-to-send', { theme: 'light', width: 380 });
          panel.querySelector('.rc-model-button').click();
          await until(() => panel.querySelector('.rc-model-option'), 'Model catalog');
          await shot('model-menu', { theme: 'light', width: 380 });
          panel.querySelector('.rc-model-button').click();
          await shot('dark-overview', { theme: 'dark', width: 380 });
        }
      });
      return;
    }
    const attachments = [];
    for (const fixture of config.fixtures) {
      const parent = new Zotero.Item('report');
      parent.setField('title', fixture.name);
      await parent.saveTx();
      const attachment = await Zotero.Attachments.importFromFile({
        file: fixture.path,
        parentItemID: parent.id,
      });
      attachments.push(attachment);
    }
    const [specification, library, selection] = attachments;
    if (config.only === 'model-chat') {
      report.scope = 'model-chat-simulated-api';
      await runModelChat({
        environment,
        config,
        report,
        window,
        open,
        specification,
        assert,
        until,
      });
      return;
    }
    if (config.only.startsWith('phase10-')) {
      await runPhase10({
        environment,
        config,
        window,
        open,
        specification,
        library,
        until,
        wait,
        assert,
        case_,
        report,
        persist,
        click,
      });
      return;
    }
    if (config.only === 'phase9-notes-extra') {
      await runNoteStorage({
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
      });
      return;
    }
    if (['phase9-notes', 'phase9-notes-tail'].includes(config.only)) {
      await runReadingNotes({
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
      });
      return;
    }
    if (config.only === 'redesign') {
      await runRedesign({
        environment,
        config,
        window,
        open,
        specification,
        until,
        wait,
        report,
        persist,
        assert,
        setAutomatedPointer: (active) => {
          automatedPointer = active;
        },
      });
      return;
    }
    if (config.only === 'phase9-ui') {
      await runPhase9UI({
        environment,
        config,
        window,
        open,
        specification,
        until,
        wait,
        report,
        persist,
      });
      return;
    }
    if (config.only === 'phase9-long') {
      await runLongText({
        environment,
        config,
        window,
        open,
        specification,
        until,
        wait,
        report,
        persist,
      });
      return;
    }
    if (config.only === 'real-login') {
      report.scope = 'real-login';
      await runRealLogin({
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
      });
      return;
    }
    if (['phase7-setup', 'phase7-download'].includes(config.only)) {
      await runSetupAcceptance({
        click,
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
      });
      return;
    }

    if (config.only === 'phase6-word') {
      report.scope = 'phase6-word-context';
      const index = config.corpus.findIndex((material) => material.id === 'humanities');
      await open(attachments[index + 3], config.corpus[index].pageIndex);
      await setLayout(environment, window, panel, { theme: 'light', width: 380 }, wait);
      await case_('right 的词级释义与真实文内定义', async () => {
        const controls = createSelectionControls({
          environment,
          config,
          report,
          window,
          reader,
          panel,
          wait,
          until,
          assert,
          persist,
        });
        const word = await controls.translated('right');
        const request = JSON.parse(word.request.messages[1].content);
        assert(
          /权利/u.test(word.translation) && !/隐私/u.test(word.translation),
          'Translation stays within the selected word',
        );
        assert(
          !request.definitions.some((entry) =>
            /requirements about means|means employed/u.test(entry.text),
          ),
          'The noun means is not mislabeled as a definition of right',
        );
        await IOUtils.writeJSON(PathUtils.join(config.runDirectory, 'humanities-word.json'), word);
        await shot('word-popup', { theme: 'light', width: 380 });
      });
      return;
    }
    if (['phase7-summary-tail', 'phase7-summary-view'].includes(config.only)) {
      report.scope = 'phase7-summary-regeneration-and-library';
      const product = Zotero['reading-companion@local'];
      const medical = (
        await IOUtils.getChildren(PathUtils.join(config.data, 'reading-companion'))
      ).filter((path) => /session-.*\.json$/u.test(path));
      let saved;
      for (const path of medical) {
        const session = await IOUtils.readJSON(path);
        if (session.summary?.answer.claims.some((claim) => claim.text.includes('阿片')))
          saved = session;
      }
      await open(Zotero.Items.get(saved.summary.snapshot.document.itemID), 0);
      if (config.only === 'phase7-summary-view') {
        await case_('缓存显示与一键追问', async () => {
          await shot('cached-summary', { theme: 'light', width: 380 });
          const count = (await readSession()).turns.length;
          panel.querySelector(`[data-turn-id="${saved.summary.id}"] .rc-followup`).click();
          await until(async () => {
            const session = await readSession();
            if (session.turns.at(-1)?.state === 'failed')
              throw new Error(JSON.stringify(session.turns.at(-1).error));
            return session.turns.length > count && session.turns.at(-1).answer;
          }, 'Summary followup');
          await shot('summary-followup', { theme: 'light', width: 380 });
        });
        return;
      }

      await case_('缓存恢复、重新生成与保存总结', async () => {
        assert(
          panel.querySelector(`[data-turn-id="${saved.summary.id}"]`),
          'Cached summary restored after restart',
        );
        click(panel, '重新生成');
        const updated = await until(
          async () => {
            const session = await readSession();
            return session.summary?.id !== saved.summary.id ? session.summary : null;
          },
          'Regenerated summary',
          600000,
        );
        await IOUtils.writeJSON(
          PathUtils.join(config.runDirectory, 'medicine-summary.json'),
          updated,
        );
        await shot('summary-final', { theme: 'light', width: 380 });
        click(panel.querySelector(`[data-turn-id="${updated.id}"]`), '存为子笔记');
        await until(
          () => Zotero.Items.get(currentAttachment.parentItemID).getNotes().length,
          'Saved summary note',
        );
      });
      await case_('文献库右键总结，PDF 未打开', async () => {
        window.Zotero_Tabs.select('zotero-pane');
        await window.ZoteroPane.selectItem(specification.parentItemID);
        await window.ZoteroPane.buildItemContextMenu();
        const popup = window.document.getElementById('zotero-itemmenu');
        popup.openPopupAtScreen(400, 250, true);
        const menu = await until(
          () => popup.querySelector('[data-l10n-id="reading-companion-summary"]'),
          'Library summary menu',
        );
        menu.doCommand();
        popup.hidePopup();
        await until(
          () =>
            window.document
              .querySelector('.rc-library-summary')
              ?.textContent.includes('已存为子笔记'),
          'Library summary saved',
          600000,
        );
        assert(
          !Zotero.Reader._readers.some((entry) => entry.itemID === specification.id),
          'Library summary never opened PDF',
        );
        const filename = 'library-summary.png';
        const image = await saveWindow(
          environment,
          window,
          PathUtils.join(config.runDirectory, 'screenshots', filename),
        );
        report.screenshots.push({ name: 'library-summary', filename, ...image });
        const session = await product.store.session(
          `${specification.libraryID}-${specification.key}`,
        );
        await IOUtils.writeJSON(
          PathUtils.join(config.runDirectory, 'library-summary.json'),
          session.summary,
        );
        await persist();
      });
      return;
    }
    if (config.only === 'phase7-text') {
      report.scope = 'phase7-text-order';
      for (const [index, material] of config.corpus.entries()) {
        await open(attachments[index + 3], material.pageIndex);
        await IOUtils.writeJSON(
          PathUtils.join(config.runDirectory, `${material.id}-pages.json`),
          await Zotero['reading-companion@local'].reader.pages(reader),
        );
      }
      return;
    }
    if (config.only === 'phase11') {
      report.scope = 'phase11-summary-and-expansion';
      const app = Zotero['reading-companion@local'];
      for (const [index, material] of config.corpus.entries()) {
        await open(attachments[index + 3], material.pageIndex);
        await setLayout(environment, window, panel, { theme: 'light', width: 420 }, wait);
        const live = app.workspaces.get(window).panel;
        await until(() => !live.root.classList.contains('rc-setup-active'), 'Chat ready');
        const finished = (before) =>
          until(
            () => {
              const turn = live.session.turns.at(-1);
              if (!turn || turn.id === before) return null;
              if (turn.state === 'failed') throw new Error(JSON.stringify(turn.error));
              return turn.answer ? turn : null;
            },
            material.id + ' answer',
            900000,
          );
        await case_(`总分总全文总结 ${material.id}`, async () => {
          const before = live.session.turns.at(-1)?.id;
          click(live.root, '快捷');
          click(live.root, '总结全文');
          const turn = await finished(before);
          await IOUtils.writeJSON(
            PathUtils.join(config.runDirectory, `${material.id}-summary.json`),
            { answer: turn.answer, scope: turn.scope },
          );
          await shot(material.id + '-summary', { theme: 'light', width: 420 });
          const probe = (label) => {
            const c = live.conversation;
            const node = live.renderedTurns.get(turn.id);
            return {
              label,
              scrollTop: c.scrollTop,
              scrollHeight: c.scrollHeight,
              clientHeight: c.clientHeight,
              paddingBottom: c.style.paddingBottom,
              nodeConnected: Boolean(node?.isConnected),
              nodeHeight: node?.getBoundingClientRect().height,
              nodeTop: node
                ? node.getBoundingClientRect().top - c.getBoundingClientRect().top
                : null,
              turns: c.querySelectorAll('.rc-turn').length,
            };
          };
          const probes = [probe('complete')];
          await wait(300);
          probes.push(probe('after300'));
          await wait(1500);
          probes.push(probe('after1800'));
          await IOUtils.writeJSON(
            PathUtils.join(config.runDirectory, `${material.id}-probe.json`),
            probes,
          );
          await IOUtils.writeJSON(
            PathUtils.join(config.runDirectory, `${material.id}-summary.json`),
            { answer: turn.answer, scope: turn.scope },
          );
        });
        await case_(`拓展追问 ${material.id}`, async () => {
          const before = live.session.turns.at(-1)?.id;
          live.input.value =
            '拓展一下：结合这个领域的背景，讲讲这篇工作的意义，以及和常见的其他做法相比有什么不同。';
          live.input.dispatchEvent(new window.Event('input', { bubbles: true }));
          click(live.root, '发送');
          const turn = await finished(before);
          await IOUtils.writeJSON(
            PathUtils.join(config.runDirectory, `${material.id}-expand.json`),
            { question: turn.question, answer: turn.answer },
          );
          await shot(material.id + '-expand', { theme: 'light', width: 420 });
        });
      }
      return;
    }
    if (config.only === 'phase7-summary') {
      report.scope = 'phase7-full-document-summary';
      for (const [index, material] of config.corpus.entries()) {
        await open(attachments[index + 3], material.pageIndex);
        await setLayout(environment, window, panel, { theme: 'light', width: 380 }, wait);
        await case_(`全文总结 ${material.id}`, async () => {
          const product = Zotero['reading-companion@local'];
          const run = product.models.run.bind(product.models);
          let part = 0;
          product.models.run = async (...args) => {
            const raw = await run(...args);
            const payload = JSON.parse(args[1].messages[1].content);
            if (payload.purpose === 'summary-part')
              await IOUtils.writeJSON(
                PathUtils.join(config.runDirectory, `${material.id}-part-${++part}.json`),
                { sources: payload.evidence.sources, raw },
              );
            return raw;
          };
          await IOUtils.writeJSON(
            PathUtils.join(config.runDirectory, `${material.id}-pages.json`),
            await product.reader.pages(reader),
          );
          panel.querySelector('.rc-model-button').click();
          await until(() => panel.querySelector('.rc-model-option'), 'Summary model catalog');
          const model = [...panel.querySelectorAll('.rc-model-option')].find(
            (node) => node.firstChild.textContent === 'GPT-6-Sol',
          );
          model.click();
          panel.querySelector('.rc-model-button').click();
          click(panel.querySelector('.rc-efforts'), '快');
          click(panel, '总结全文');
          const turn = await until(
            async () => {
              const session = await readSession();
              if (panel.dataset.state === 'error')
                throw new Error(panel.querySelector('.rc-status').textContent);
              if (session.turns.at(-1)?.state === 'failed')
                throw new Error(JSON.stringify(session.turns.at(-1).error));
              return session.summary;
            },
            material.id + ' summary',
            600000,
          );
          await IOUtils.writeJSON(
            PathUtils.join(config.runDirectory, `${material.id}-summary.json`),
            turn,
          );
          await shot(material.id + '-summary', { theme: 'light', width: 380 });
          assert(
            turn.answer.claims.every((claim) => claim.citations.length),
            'Each point has source pages',
          );
          const count = (await readSession()).turns.length;
          click(panel, '总结全文');
          await wait(800);
          assert(
            (await readSession()).turns.length === count,
            'Summary cache avoids another request',
          );
        });
      }
      return;
    }
    if (config.only === 'phase6-corpus') {
      report.scope = 'phase6-cross-disciplinary-five-questions';
      for (const [index, material] of config.corpus.entries()) {
        await open(attachments[index + 3], material.pageIndex);
        await setLayout(environment, window, panel, { theme: 'light', width: 380 }, wait);
        await case_(`跨学科：${material.id}`, async () => {
          await until(
            () => !panel.querySelector('.rc-model-button').textContent.includes('默认模型'),
            'Default model resolved',
          );
          const input = panel.querySelector('textarea');
          input.value = material.question;
          input.dispatchEvent(new window.Event('input', { bubbles: true }));
          click(panel, '发送');
          const turn = await until(async () => {
            const last = (await readSession()).turns.at(-1);
            if (last?.state === 'failed') throw new Error(JSON.stringify(last.error));
            return last?.answer ? last : null;
          }, material.id + ' answer');
          assert(
            turn.snapshot.pageIndex === material.pageIndex,
            'Actual source page matches question',
          );
          await IOUtils.writeJSON(
            PathUtils.join(config.runDirectory, `${material.id}-answer.json`),
            turn,
          );
          await IOUtils.writeUTF8(
            PathUtils.join(config.runDirectory, `${material.id}-answer.md`),
            turn.answer.claims.map((claim) => claim.text).join('\n\n') || turn.answer.text,
          );
          if (material.id === 'math') await shot('math-answer', { theme: 'light', width: 380 });
          if (material.id === 'humanities') {
            const controls = createSelectionControls({
              environment,
              config,
              report,
              window,
              reader,
              panel,
              wait,
              until,
              assert,
              persist,
            });
            const word = await controls.translated('right');
            assert(
              /权利/u.test(word.translation) && !/隐私/u.test(word.translation),
              'Selected right stays word-level rather than expanding to right to privacy',
            );
            await IOUtils.writeJSON(
              PathUtils.join(config.runDirectory, 'humanities-word.json'),
              word,
            );
            await shot('word-popup', { theme: 'light', width: 380 });
          }
        });
      }
      return;
    }
    if (['phase6', 'phase6-full'].includes(config.only)) {
      await open(selection, 0);
      await runPhase6({
        environment,
        config,
        report,
        window,
        reader,
        panel,
        wait,
        until,
        assert,
        case_,
        readSession,
        persist,
        click,
        open,
        specification,
      });
      return;
    }
    if (
      ['fast', 'fast-smoke', 'fast-cold', 'fast-all', 'annotations', 'notebook'].includes(
        config.only,
      )
    ) {
      report.scope = ['fast', 'fast-all'].includes(config.only)
        ? 'selection-translation'
        : config.only === 'fast-cold'
          ? 'selection-cold'
          : 'selection-smoke';
      await open(selection, 0);
      await runSelectionAcceptance({
        environment,
        config,
        report,
        window,
        reader,
        panel,
        wait,
        until,
        assert,
        case_,
        matrix,
        submit,
        readSession,
        persist,
        setAutomatedPointer: (active) => {
          automatedPointer = active;
        },
      });
      return;
    }
    if (config.only === 'render') {
      report.scope = 'render-only';
      await open(specification, 2);
      for (let cycle = 0; cycle < 3; cycle++) {
        await reader.navigate({ pageIndex: cycle % 2 ? 2 : 4 });
        await until(() => currentPage() === (cycle % 2 ? 2 : 4), 'Render fixture page', 10000);
        await case_(`render-${cycle}`, () => matrix(`render-${cycle}`));
      }
      return;
    }
    if (config.only === 'selection') {
      report.scope = 'selection-only';
      await open(library, 0);
      await case_('selected-text-layouts', selectText);
      return;
    }
    await open(specification, 2);
    await case_('workspace-round-trip', async () => {
      const workspace = panel.closest('.rc-workspace');
      click(workspace, '返回条目面板');
      assert(
        workspace.hidden && !window.document.getElementById('zotero-context-pane-inner').hidden,
        'Returning restores native item and notes context',
      );
      const entry = window.document
        .querySelector('#zotero-context-pane-item-deck')
        .selectedPanel.querySelector('[data-rc-open-workspace]');
      entry.click();
      assert(!workspace.hidden && currentPage() === 2, 'Reopening preserves the reader page');
    });
    await case_('empty-layouts', () => matrix('empty'));
    await case_('error-layouts', async () => {
      panel.querySelector('.rc-options').hidden = false;
      change(field(panel, '用途'), 'translate-selection');
      panel.querySelector('.rc-options').hidden = true;
      click(panel, '发送');
      await until(
        () => /尚未选中文字/u.test(panel.querySelector('.rc-status').textContent),
        'Selection error',
        10000,
      );
      await matrix('error');
    });
    const openSettings = async (activate = true) => {
      if (activate) {
        click(panel, '更多');
        click(panel, '模型设置');
      }
      return until(
        () => {
          return [...Services.wm.getEnumerator('zotero:pref')].find((candidate) => {
            return candidate.document.getElementById('reading-companion-settings')
              ?.childElementCount;
          });
        },
        'Preferences window',
        20000,
      );
    };
    const emptyContext = {
      openSettings,
      getPanel: () => panel,
      click,
      change,
      field,
      until,
      assert,
      case_,
      matrix,
      open,
      scan: attachments[3],
      readSession,
    };
    if (!config.only || config.only === 'ui') await runModelEmptyAcceptance(emptyContext);
    const connection = await case_('settings-and-real-connection', async () => {
      const settingsWindow = await openSettings();
      const settings = settingsWindow.document.getElementById('reading-companion-settings');
      settingsWindow.resizeTo(1100, 1100);
      await matrix('settings', settingsWindow, settings);
      settings.querySelector('[data-provider="codex"]').click();
      click(settings, '高级');
      change(field(settings, '超时秒数'), '180');
      if (config.only === 'visual') {
        report.scope = 'visual-only';
        settingsWindow.close();
        return;
      }
      click(settings, '测试连接');
      await until(
        () => {
          if (settingsWindow.closed)
            throw new Error('Preferences window closed during capability test');
          const status = settings.querySelector('[role="status"]')?.textContent || '';
          if (/未通过|失败|超时|登录失效|不可用/u.test(status)) {
            throw new Error(`Codex capability test: ${status}`);
          }
          return /文本通过，图像通过/u.test(status);
        },
        'Real Codex probe',
        240000,
      );
      assert(
        settings.querySelector('[data-provider="codex"] [data-status="passed"]'),
        'Successful probe has a green status dot',
      );
      settings.querySelector('[data-provider="codex"]').click();
      await matrix('settings-passed', settingsWindow, settings);
      settingsWindow.close();
      window.focus();
      return { text: true, vision: true };
    });
    if (config.only === 'visual') return;
    if (!connection)
      throw new Error('Reading scenarios require a successful Codex capability test');
    if (!config.only || config.only === 'ui') await runScanEmptyAcceptance(emptyContext);
    if (config.only === 'ui') {
      report.scope = 'ui-completion';
      return;
    }
    if (config.only === 'corpus') {
      await runCorpusAcceptance({
        environment,
        config,
        report,
        window,
        wait,
        until,
        assert,
        case_,
        persist,
        open,
        submit,
        readSession,
        shot,
        attachments: attachments.slice(3),
        getReader: () => reader,
        getPanel: () => panel,
        setAutomatedPointer: (active) => {
          automatedPointer = active;
        },
      });
      return;
    }
    const registerTranslation = () =>
      case_('register-translation', async () => {
        await open(specification, 5);
        const response = await submit('register', '', 'translate-page', layouts[3]);
        const rows = response.turn.answer.translation.rows;
        const article = panel.querySelector(`[data-turn-id="${response.turn.id}"]`);
        assert(
          article.querySelectorAll('.rc-bilingual-table table').length === 1,
          'Register translation renders one bilingual table',
        );
        assert(
          !article.querySelector('.rc-translation .rc-claim-label'),
          'Translation groups omit repeated source/target labels',
        );
        assert(
          rows.some((row) => row.original.includes('Offset') && row.original.includes('W1C')),
          'Register header and cells remain in a single table target',
        );
        assert(
          rows.findIndex((row) => row.original.includes('Offset')) <
            rows.findIndex((row) => row.original.includes('Teaching protocol')),
          'Footer follows register table',
        );
        assert(
          rows.some((row) => row.original.includes('aborted read')),
          'Read-clear footnote included',
        );
        await matrix('translation');
        return response.evidence;
      });
    if (config.only === 'translation') {
      report.scope = 'translation-layout';
      await registerTranslation();
      return;
    }
    const positive = await case_('positive-send-then-flip', async () => {
      await open(specification, 2);
      const response = await submit(
        'positive',
        '第三拍为什么不能换数据？请给出图和条款出处，并用表格列出第 1 至第 5 拍的状态。',
        'ask',
        layouts[0],
        4,
      );
      assert(
        response.evidence.pageIndex === 2 && !response.evidence.hasSelection,
        'Positive uses file page 3 without selection after flipping to page 5',
      );
      assert(response.evidence.printedPage === '2', 'Positive PDF label is preserved');
      assert(
        response.evidence.images.some((image) => image.pageIndex === 2),
        'Frozen positive image',
      );
      assert(
        response.evidence.sources.some((source) => source.pageIndex === 1),
        'Retrieved HOLD rule',
      );
      assert(/保持|稳定/u.test(response.turn.answer.text), 'Positive explains data stability');
      await matrix('answer-with-citations');
      await matrix('basis-mismatch');
      await matrix('timing-table');
      assert(
        response.turn.answer.claims.some((claim) => claim.citations.length),
        'Completed screenshot contains an answer with citations',
      );
      return response.evidence;
    });
    await case_('follow-up-retains-evidence', async () => {
      const response = await submit('follow-up', '为什么？', 'ask', layouts[1]);
      assert(response.evidence.pageIndex === 2, 'Why stays on the previous figure');
      assert(
        positive && response.evidence.images[0].sha256 === positive.images[0].sha256,
        'Follow-up reuses exactly the same pixels',
      );
      return response.evidence;
    });
    await case_('negative-current-view', async () => {
      await reader.navigate({ pageIndex: 4 });
      const response = await submit(
        'negative',
        '那现在这张图呢？第三拍为什么不能换数据？',
        'ask',
        layouts[2],
      );
      assert(response.evidence.pageIndex === 4, 'Explicit new view uses file page 5');
      assert(
        !response.evidence.hasSelection &&
          response.evidence.printedPage === '4' &&
          response.evidence.images.some((image) => image.pageIndex === 4),
        'Counterexample sends the current image without selection and preserves its PDF label',
      );
      assert(
        response.evidence.sources.some((source) => source.pageIndex === 3),
        'Retrieved SAMPLE rule',
      );
      assert(
        /允许|可以|前提.*纠正/u.test(response.turn.answer.text),
        'Counterexample corrects premise',
      );
      return response.evidence;
    });
    await case_('ambiguous-view-choice', async () => {
      await open(specification, 2);
      const response = await submit(
        'choice',
        '它有什么限制？',
        'ask',
        layouts[0],
        undefined,
        'current',
      );
      assert(
        response.evidence.pageIndex === 2 && currentPage() === 0,
        'Choice uses the offered page, not the page navigated to while choosing',
      );
      assert(
        response.evidence.decision.requestedMode === 'current' &&
          response.evidence.decision.reason === 'explicit-control',
        'Explicit choice is recorded in the actual model payload',
      );
      return response.evidence;
    });
    await registerTranslation();
    await case_('citation-jump-and-child-note', async () => {
      const session = await readSession();
      const targetTurn = session.turns.find((turn) =>
        turn.answer?.claims.some((claim) => {
          return claim.citations.length;
        }),
      );
      assert(targetTurn, 'Answer has clickable citations');
      const article = panel.querySelector(`[data-turn-id="${targetTurn.id}"]`);
      const citation = targetTurn.answer.claims.flatMap((claim) => claim.citations)[0];
      await reader.navigate({ pageIndex: citation.pageIndex === 0 ? 4 : 0 });
      article.querySelector('.rc-claim button').click();
      await until(() => currentPage() === citation.pageIndex, 'Citation page changed', 10000);
      const parent = Zotero.Items.get(specification.parentItemID);
      const before = parent.getNotes();
      click(panel, '更多');
      click(panel, '导出当前回答为子笔记');
      const noteId = await until(
        () => parent.getNotes().find((id) => !before.includes(id)),
        'Child note created',
        10000,
      );
      const note = await Zotero.Items.getAsync(noteId);
      await IOUtils.writeUTF8(
        PathUtils.join(config.runDirectory, 'child-note.html'),
        note.getNote(),
      );
      const storedParent = await Zotero.DB.valueQueryAsync(
        'SELECT parentItemID FROM itemNotes WHERE itemID = ?',
        [noteId],
      );
      const storedNote = await Zotero.DB.valueQueryAsync(
        'SELECT note FROM itemNotes WHERE itemID = ?',
        [noteId],
      );
      assert(
        storedParent === parent.id && storedNote.includes('zotero://open-pdf/'),
        'Database child note has correct parent and evidence links',
      );
      return {
        requestedPage: citation.pageIndex,
        observedPage: currentPage(),
        parentID: parent.id,
        noteID: note.id,
        databaseParentID: storedParent,
      };
    });
    const specCount = (await readSession()).turns.length;
    await case_('library-translation-and-isolation', async () => {
      await open(library, 0);
      assert(
        (await readSession()).turns.length === 0,
        'Second document starts with its own session',
      );
      const response = await submit('library', '', 'translate-page', layouts[0]);
      const rows = response.turn.answer.translation.rows;
      assert(
        rows.some(
          (row) =>
            row.original.includes('cannot establish that') && row.original.includes('caused'),
        ),
        'Causal negation and proposition share a paragraph',
      );
      const visitRows = rows.filter((row) => /\bvisits\b/iu.test(row.original));
      assert(
        visitRows.length > 0 &&
          visitRows.every((row) => {
            return (
              /次数|人次|访问量|到访量/u.test(row.translation) ||
              row.issues.some((issue) => issue.includes('visits'))
            );
          }),
        'Visits stays a count or receives a precise fidelity warning',
      );
      await open(specification, 2);
      assert((await readSession()).turns.length === specCount, 'First document keeps its session');
      await open(library, 0);
      assert((await readSession()).turns.length === 1, 'Second document session is retained');
      return response.evidence;
    });
    await case_('selected-text-layouts', selectText);
    await case_('glossary-and-latest-layouts', async () => {
      await open(specification, 5);
      click(panel, '更多');
      click(panel, '本篇术语表');
      await matrix('glossary');
      click(panel, '收起术语表');
      await matrix('latest-position');
    });
    const requiredStates = [
      'empty',
      'selected',
      'streaming',
      'answer-with-citations',
      'error',
      'translation',
      'settings',
    ];
    await case_('screenshot-coverage', async () => {
      for (const state of requiredStates) {
        for (const layout of layouts) {
          assert(
            report.screenshots.some(
              (image) =>
                image.name === state &&
                image.requested.theme === layout.theme &&
                image.requested.width === layout.width,
            ),
            `Screenshot exists: ${state}/${layout.theme}/${layout.width}`,
          );
        }
      }
    });
  } catch (error) {
    report.fatal ||= String(error.message || error).slice(0, 600);
    if (!stopping) await diagnose('fatal', error);
  } finally {
    for (const [targetWindow, handler] of inputListeners) {
      for (const type of ['wheel', 'pointerdown', 'keydown']) {
        try {
          targetWindow.removeEventListener(type, handler, true);
        } catch {}
      }
    }
    for (const observer of scrollObservers.values()) {
      try {
        observer.disconnect();
      } catch {}
    }
    if (stopTimer) window.clearInterval(stopTimer);
    if (stoppingDiagnostic) await stoppingDiagnostic;
    report.finished = new Date().toISOString();
    report.status =
      report.fatal ||
      report.cases.some((entry) => entry.state === 'failed') ||
      report.assertions.some((entry) => !entry.passed)
        ? 'failed'
        : 'passed';
    await persist();
    if (Zotero.DataDirectory.dir === config.data) {
      Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
    }
  }
}
