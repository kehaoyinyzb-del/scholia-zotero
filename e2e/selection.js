import { runNotebookAcceptance } from './notebook.js';
import { runAnnotationAcceptance } from './annotations.js';
import { layouts, setLayout, saveWindow } from './screenshots.js';

export function createSelectionControls(context) {
  const { environment, report, window, reader, panel, wait, until, assert, persist } = context;
  const { Components, Zotero } = environment;
  const product = Zotero['reading-companion@local'];
  const records = () => product.selection.records;
  const root = () => reader._iframeWindow.document.querySelector('.rc-popup');
  const select = async (text, expectPopup = true, endText = null) => {
    const view = reader._internalReader._lastView || reader._internalReader._primaryView;
    const frame = view._iframeWindow;
    const viewer = frame.PDFViewerApplication.pdfViewer;
    const page = viewer.getPageView(viewer.currentPageNumber - 1).div;
    const spans = () => [...page.querySelectorAll('.textLayer span')];
    const node = await until(
      () =>
        spans().find((span) => span.textContent.trim() === text) ||
        spans().find((span) => span.textContent.includes(text)),
      'Selection fixture text: ' + text,
      10000,
    );
    const endNode = endText
      ? spans()
          .slice(spans().indexOf(node))
          .find((span) => span.textContent.includes(endText))
      : node;
    assert(endNode, 'Selection passage end exists');
    const normalize = (value) => (value || '').replace(/\s+/gu, ' ').trim();
    const matches = (value) =>
      endText
        ? normalize(value).startsWith(normalize(text)) &&
          normalize(value).endsWith(normalize(endText))
        : context.allowExpandedSelection
          ? normalize(value).includes(normalize(text))
          : normalize(value) === normalize(text);
    const utility = Components.utils.unwaiveXrays(frame).windowUtils;
    let held = false;
    const mouse = (...args) => {
      if (args[0] === 'mousedown') held = true;
      if (args[0] === 'mouseup') held = false;
      context.setAutomatedPointer?.(true);
      try {
        utility.sendMouseEventToWindow(...args, false, 0, 1, true, false, held ? 1 : 0);
      } finally {
        context.setAutomatedPointer?.(false);
      }
    };
    {
      // A first click also activates the PDF after closing a native preferences window.
      const x = frame.innerWidth - 40;
      const y = frame.innerHeight - 40;
      mouse('mousedown', x, y, 0, 1, 0);
      mouse('mouseup', x, y, 0, 1, 0);
      await until(() => !root(), 'Previous popup dismissed', 5000);
      await wait(200);
    }
    const range = frame.document.createRange();
    range.setStart(node.firstChild, node.textContent.indexOf(text));
    const ending = endText || text;
    range.setEnd(endNode.firstChild, endNode.textContent.indexOf(ending) + ending.length);
    const rectangles = [...range.getClientRects()];
    const box = rectangles[0];
    const lastBox = rectangles.at(-1);
    const endX = lastBox.right - 0.5;
    const endY = lastBox.top + lastBox.height / 2;
    const y = box.top + box.height / 2;
    (report.selectionDrags ||= []).push({
      text,
      endText,
      box: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      },
      html: node.outerHTML.slice(0, 800),
      frame: { width: frame.innerWidth, height: frame.innerHeight },
    });
    await persist();
    const startX = box.left + 0.5;
    mouse('mousemove', startX, y, 0, 0, 0);
    await wait(50);
    mouse('mousedown', startX, y, 0, 1, 0);
    await wait(50);
    for (let i = 1; i <= 8; i++) {
      mouse('mousemove', startX + ((endX - startX) * i) / 8, y + ((endY - y) * i) / 8, 0, 0, 0);
      await wait(20);
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      mouse('mousemove', endX, endY, 0, 0, 0);
      await wait(100);
      if (view._selectionRanges.some((range) => matches(range.text))) break;
    }
    const release = Date.now();
    mouse('mouseup', endX, endY, 0, 1, 0);
    if (expectPopup)
      await until(
        () => matches(root()?.querySelector('.rc-selection-original')?.textContent),
        'Native selection popup for exact text',
        10000,
      );
    assert(
      view._selectionRanges.some((range) => matches(range.text)),
      'Native selection matches the full requested phrase',
    );
    return release;
  };
  const completed = async (text, release) => {
    const entry = await until(
      () => {
        const record = records().at(-1);
        if (record?.state === 'failed') throw new Error(JSON.stringify(record.error));
        if (record && record.selected !== text && record.mouseRelease >= release) {
          throw new Error('Native selection changed during the requested translation');
        }
        return record?.state === 'complete' && record.selected === text ? record : null;
      },
      'Selection translated: ' + text,
      90000,
    );
    assert(
      root().querySelector('.rc-selection-result').textContent === entry.translation,
      'Visible popup equals the recorded translation',
    );
    return { ...entry, measuredFromReleaseMs: Date.now() - release };
  };
  const translated = async (text) => completed(text, await select(text));
  const setTrigger = async (mode) => {
    panel.querySelector('[aria-label="更多"]').click();
    [...panel.querySelectorAll('button')].find((node) => node.textContent === '模型设置').click();
    const settingsWindow = await until(
      () =>
        [...environment.Services.wm.getEnumerator('zotero:pref')].find((entry) =>
          entry.document.querySelector('.rc-settings'),
        ),
      'Selection settings window',
    );
    const settings = settingsWindow.document.querySelector('.rc-settings');
    const label = [...settings.querySelectorAll('label')].find(
      (node) => node.querySelector('span')?.textContent === '划词翻译',
    );
    label.querySelector('select').value = mode;
    label
      .querySelector('select')
      .dispatchEvent(new label.ownerDocument.defaultView.Event('change', { bubbles: true }));
    await until(() => settings.textContent.includes('已自动应用'), 'Selection trigger saved');
    settingsWindow.close();
    window.focus();
  };
  return { records, root, select, completed, translated, setTrigger };
}

export async function runSelectionAcceptance(context) {
  const { environment, config, report, window, panel, wait, until, assert, case_, persist } =
    context;
  const { Zotero, IOUtils, PathUtils } = environment;
  const product = Zotero['reading-companion@local'];
  const { records, root, select, completed, translated, setTrigger } =
    createSelectionControls(context);
  const popupBounds = () => {
    const box = root().getBoundingClientRect();
    const view = root().ownerDocument.defaultView;
    return {
      left: box.left + view.mozInnerScreenX - window.mozInnerScreenX,
      top: box.top + view.mozInnerScreenY - window.mozInnerScreenY,
      width: box.width,
      height: box.height,
    };
  };
  if (config.only === 'notebook') {
    report.scope = 'notebook';
    await runNotebookAcceptance({ ...context, select, translated, root });
    return;
  }
  if (config.only === 'annotations') {
    report.scope = 'annotations';
    await runAnnotationAcceptance({ ...context, select, translated, root });
    return;
  }
  if (['fast-cold', 'fast-all'].includes(config.only)) {
    await case_('selection-cold-start', async () => {
      await setLayout(environment, window, panel, layouts[0], wait);
      const release = await select('assert');
      await wait(200);
      const filename = 'selection-popup-loading-light-280.png';
      const shot = await saveWindow(
        environment,
        window,
        PathUtils.join(config.runDirectory, 'screenshots', filename),
      );
      report.screenshots.push({
        name: 'selection-popup-loading',
        filename,
        requested: layouts[0],
        ...shot,
      });
      const result = await completed('assert', release);
      assert(!result.cacheHit, 'Cold selection is not cached');
      report.coldSelection = result;
      report.selectionRuntime = { ...product.models.selectionPool.info };
      assert(
        result.started < report.selectionRuntime.warmedAt,
        'Mouse selection occurred before prewarm completed',
      );
      await IOUtils.writeJSON(PathUtils.join(config.runDirectory, 'cold-selection.json'), {
        result,
        runtime: report.selectionRuntime,
      });
      return result;
    });
    await case_('selection-trigger-modes', async () => {
      await setTrigger('click');
      await select('assert');
      await wait(250);
      assert(!records().at(-1).request, 'Click mode does not start inference before click');
      root().querySelector('[aria-label="翻译选区"]').click();
      await completed('assert', Date.now());
      await setTrigger('off');
      const count = records().length;
      await select('The source shall not change DATA for 3 cycles.', false);
      await wait(300);
      assert(
        !root() && records().length === count,
        'Off mode neither shows popup nor requests inference',
      );
      await setTrigger('auto');
      return { click: 'passed', off: 'passed', restored: 'auto' };
    });
    if (config.only === 'fast-cold') return;
  }
  await case_('selection-prewarm', async () => {
    const info = await until(
      () => product.models.selectionPool.info?.warmedAt && product.models.selectionPool.info,
      'Persistent Codex warmed',
      90000,
    );
    assert(info.pid && info.model && info.effort, 'Warm instance exposes actual PID/model/effort');
    report.selectionRuntime = { ...info };
    return report.selectionRuntime;
  });
  await case_('selection-word-context', async () => {
    const result = await translated('assert');
    assert(
      /置|有效|激活|拉高/u.test(result.translation.split(/[；;\n]/u)[0]),
      'Assert receives the digital signal meaning',
    );
    assert(result.request.images.length === 0, 'Selection request never sends images');
    report.wordTranslation = result;
    const popupBox = root().getBoundingClientRect();
    const nativeBox = root().closest('.selection-popup').getBoundingClientRect();
    assert(popupBox.right <= nativeBox.right + 1, 'Translation fits inside native popup');
    for (const layout of layouts) {
      await setLayout(environment, window, panel, layout, wait);
      await translated('assert');
      const filename = `selection-popup-${layout.theme}-${layout.width}.png`;
      const image = await saveWindow(
        environment,
        window,
        PathUtils.join(config.runDirectory, 'screenshots', filename),
      );
      report.screenshots.push({
        name: 'selection-popup',
        filename,
        requested: layout,
        ...image,
        popup: popupBounds(),
      });
    }
    return result;
  });
  await case_('selection-negation-numbers', async () => {
    const result = await translated('The source shall not change DATA for 3 cycles.');
    assert(
      /3/u.test(result.translation) &&
        /不得|不能|禁止|不允许|必须.*不变/u.test(result.translation) &&
        /DATA/u.test(result.translation),
      'Negation, number, and signal name retained',
    );
    for (const layout of layouts) {
      await setLayout(environment, window, panel, layout, wait);
      await translated('The source shall not change DATA for 3 cycles.');
      const filename = `selection-sentence-${layout.theme}-${layout.width}.png`;
      const image = await saveWindow(
        environment,
        window,
        PathUtils.join(config.runDirectory, 'screenshots', filename),
      );
      report.screenshots.push({
        name: 'selection-sentence',
        popup: popupBounds(),
        filename,
        requested: layout,
        ...image,
      });
    }
    return result;
  });
  if (config.only === 'fast-smoke') {
    await IOUtils.writeJSON(
      PathUtils.join(config.runDirectory, 'selection-responses.json'),
      records(),
    );
    return;
  }
  await case_('selection-cancel-stale-results', async () => {
    const first = records().length;
    await select('A latch stores a bit while its enable input is inactive.');
    await wait(300);
    await select('The gate must remain closed for 12 ns.');
    await wait(300);
    const result = await translated('The result does not establish a causal effect.');
    const attempts = records().slice(first);
    assert(
      attempts.length >= 3 && attempts.slice(0, 2).every((entry) => entry.state === 'cancelled'),
      'First two requests cancelled by newer native selections',
    );
    assert(
      root().querySelector('.rc-selection-original').textContent === result.selected,
      'Only the final selection remains visible',
    );
    return attempts;
  });
  await case_('selection-cache', async () => {
    const result = await translated('assert');
    assert(result.cacheHit, 'Repeated selection uses the document/context cache');
    return result;
  });
  await case_('selection-glossary-and-followup', async () => {
    const term = root().querySelector('[aria-label="加入术语表"]');
    term.click();
    const input = root().querySelector('[aria-label="术语译法"]');
    input.value = '置为有效（用户纠正）';
    [...root().querySelectorAll('button')]
      .find((button) => button.textContent === '保存术语')
      .click();
    await until(() => root().textContent.includes('已加入本篇术语表'), 'Glossary correction saved');
    const result = await translated('assert');
    assert(
      result.glossaryHit && result.translation === '置为有效（用户纠正）',
      'User correction overrides model and cached dictionary meaning',
    );
    root().querySelector('[aria-label="追问译文"]').click();
    await until(
      () => panel.querySelector('textarea').value.includes(result.translation),
      'Follow-up brings source and translation into sidebar',
    );
    assert(panel.querySelector('textarea').value.includes('assert'), 'Follow-up retains original');
    return result;
  });
  await case_('selection-latency-20', async () => {
    const results = [];
    for (let i = 1; i <= 20; i++) {
      const result = await translated(`Sample ${i}: The measured delay is ${i + 1} ns.`);
      assert(!result.cacheHit, 'Latency trial uses a fresh selection');
      results.push(result);
      report.latencyTrials = results;
      await persist();
    }
    const stats = (key) => {
      const values = results.map((entry) => entry[key]).sort((a, b) => a - b);
      return { median: (values[9] + values[10]) / 2, worst: values[19], count: 20 };
    };
    assert(
      product.models.selectionPool.info.pid === report.selectionRuntime.pid,
      'All 20 translations reuse the warmed app-server process',
    );
    report.selectionLatency = { firstMs: stats('firstMs'), completeMs: stats('completedMs') };
    return report.selectionLatency;
  });
  await case_('selection-process-recovery', async () => {
    const priorPID = product.models.selectionPool.connection.pid;
    assert(
      Number.isInteger(priorPID) && priorPID > 0,
      'Recovery targets our live selection process',
    );
    const { Subprocess } = environment.ChromeUtils.importESModule(
      'resource://gre/modules/Subprocess.sys.mjs',
    );
    const kill = await Subprocess.call({
      command: '/bin/kill',
      arguments: ['-TERM', String(priorPID)],
    });
    await kill.wait();
    await until(
      () => product.models.selectionPool.connection.client.closed,
      'Isolated app-server process exited',
      10000,
    );
    const result = await translated('Selection translation / original fixture');
    assert(
      product.models.selectionPool.info.pid !== priorPID,
      'A new app-server process recovers the next translation',
    );
    return { recovered: true, translation: result.translation };
  });
  await case_('selection-idle-recycle', async () => {
    window.Zotero_Tabs.close(window.Zotero_Tabs.selectedID);
    await until(() => Zotero.Reader._readers.length === 0, 'All reader tabs closed', 10000);
    await until(
      () => !product.models.selectionPool.connection,
      'Idle selection process reclaimed',
      45000,
    );
    return { reclaimed: true };
  });
  await IOUtils.writeJSON(
    PathUtils.join(config.runDirectory, 'selection-responses.json'),
    records(),
  );
  await IOUtils.writeJSON(PathUtils.join(config.runDirectory, 'selection-latency.json'), {
    runtime: report.selectionRuntime,
    statistics: report.selectionLatency,
    trials: report.latencyTrials,
  });
}
