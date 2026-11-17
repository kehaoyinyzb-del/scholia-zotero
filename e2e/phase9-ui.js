import { setLayout, saveWindow } from './screenshots.js';

export async function runPhase9UI(context) {
  const { environment, config, window, open, specification, until, wait, report, persist } =
    context;
  const { Zotero, PathUtils } = environment;
  const app = Zotero['reading-companion@local'];
  await open(specification, 0);
  const panel = app.workspaces.get(window).panel;
  await until(() => !panel.root.classList.contains('rc-setup-active'), 'Chat ready');
  report.scope = 'phase9-v4-ui';
  const shot = async (name, theme = 'light') => {
    await setLayout(environment, window, panel.root, { theme, width: 380 }, wait);
    const filename = name + '.png';
    report.screenshots.push({
      name,
      filename,
      ...(await saveWindow(
        environment,
        window,
        PathUtils.join(config.runDirectory, 'screenshots', filename),
      )),
    });
    await persist();
  };
  await shot('empty');
  panel.root.querySelector('.rc-quick-button').click();
  await shot('quick-menu');
  panel.root.querySelector('.rc-quick-button').click();
  panel.modelMenu.button.click();
  await until(() => panel.root.querySelector('.rc-model-option'), 'Models visible');
  await shot('models');
  panel.modelMenu.button.click();
  panel.showHistory();
  await shot('history');
  panel.conversation.querySelector('.rc-history').remove();
  panel.showGlossary();
  await shot('glossary');
  panel.root.querySelector('.rc-glossary')?.remove();
  app.openSettings();
  const preferences = await until(
    () =>
      [...environment.Services.wm.getEnumerator('zotero:pref')].find((entry) =>
        entry.document.querySelector('.rc-settings'),
      ),
    'Settings',
  );
  const filename = 'settings.png';
  report.screenshots.push({
    name: 'settings',
    filename,
    ...(await saveWindow(
      environment,
      preferences,
      PathUtils.join(config.runDirectory, 'screenshots', filename),
    )),
  });
  preferences.close();
  for (const entry of config.legacySessions || []) {
    const session = await app.store.session(entry.documentId);
    if (!session.summary) continue;
    await open(Zotero.Items.get(session.summary.snapshot.document.itemID), 0);
    await shot('summary');
    await shot('summary-dark', 'dark');
    report.elements = {
      answerModelRows: panel.root.querySelectorAll('.rc-answer-model').length,
      sentPageChips: panel.root.querySelectorAll('.rc-sent-page').length,
      categoryLabels: panel.root.querySelectorAll('.rc-claim-label').length,
      oldShortcutRows: panel.root.querySelectorAll('.rc-secondary').length,
      toolbarButtons: [...panel.root.querySelectorAll('.rc-composer-bar > button')]
        .filter((node) => node.getClientRects().length)
        .map((node) => node.getAttribute('aria-label') || node.textContent),
    };
    break;
  }
  await persist();
}
