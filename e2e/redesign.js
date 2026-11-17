import { catalogKey } from '../src/domain/configuration.js';
import { setLayout, saveWindow } from './screenshots.js';
import { createSelectionControls } from './selection.js';

/**
 * Visual review pass for the front-end redesign. It only photographs real states of the
 * shipped XPI against a seeded isolated library; nothing here asserts visual details.
 */
export async function runRedesign(context) {
  const { environment, config, window, open, specification, until, wait, report, persist } =
    context;
  const { Zotero, PathUtils, Services } = environment;
  const app = Zotero['reading-companion@local'];
  report.scope = 'redesign-visual';
  const views = new Set((config.views || 'conv,menus,panels,settings,popup').split(','));
  const layouts = (config.layouts || 'light-380,dark-380').split(',').map((entry) => {
    const [theme, width] = entry.split('-');
    return { theme, width: Number(width) };
  });
  const shot = async (name, layout) => {
    const filename = `${name}-${layout.theme}-${layout.width}.png`;
    report.screenshots.push({
      name,
      filename,
      ...(await saveWindow(
        environment,
        window,
        PathUtils.join(config.runDirectory, 'screenshots', filename),
        Number(config.scale || 1),
      )),
    });
    await persist();
  };
  const step = async (name, callback) => {
    try {
      await callback();
    } catch (error) {
      (report.redesignErrors ||= []).push({ name, error: String(error), stack: error.stack });
      await persist();
    }
  };
  const settle = () => wait(350);

  const sessions = [];
  for (const entry of config.legacySessions || []) {
    const session = await app.store.session(entry.documentId);
    if (session.turns.length || session.summary) sessions.push(session);
  }
  sessions.sort((a, b) => b.turns.length - a.turns.length);
  const itemFor = (session) => {
    const [libraryID, key] = session.documentId.split('-');
    return Zotero.Items.getByLibraryAndKey(Number(libraryID), key);
  };
  const primary = sessions[0] ? itemFor(sessions[0]) : specification;
  await open(primary, 0);
  const panel = app.workspaces.get(window).panel;
  await until(() => !panel.root.classList.contains('rc-setup-active'), 'Chat ready');
  const conversation = () => panel.root.querySelector('.rc-conversation');

  for (const layout of layouts) {
    await setLayout(environment, window, panel.root, layout, wait);
    if (views.has('fonts'))
      await step('fonts', async () => {
        // Same summary under candidate reading faces, to choose on real rendering.
        conversation().scrollTop = 0;
        const candidates = {
          songti: '',
          'serif-pingfang': "var(--rc-serif), 'PingFang SC', sans-serif",
          sans: 'var(--rc-font)',
          'songti-16': '',
        };
        for (const [name, family] of Object.entries(candidates)) {
          panel.root.style.setProperty('--rc-read', family || null);
          if (!family) panel.root.style.removeProperty('--rc-read');
          for (const node of panel.root.querySelectorAll('.rc-prose'))
            node.style.fontSize = name === 'songti-16' ? '16px' : '';
          await settle();
          await shot(`font-${name}`, layout);
        }
        panel.root.style.removeProperty('--rc-read');
        for (const node of panel.root.querySelectorAll('.rc-prose')) node.style.fontSize = '';
      });
    if (views.has('conv'))
      await step('conversation', async () => {
        if (panel.documentId !== sessions[0]?.documentId && sessions[0]) {
          await open(primary, 0);
          await setLayout(environment, window, panel.root, layout, wait);
        }
        for (const [index, session] of sessions.entries()) {
          if (index) {
            await open(itemFor(session), 0);
            await setLayout(environment, window, panel.root, layout, wait);
          }
          await until(() => panel.root.querySelector('.rc-turn'), 'Turns rendered', 10000);
          await settle();
          conversation().scrollTop = 0;
          await settle();
          await shot(`conv${index}-top`, layout);
          const scroller = conversation();
          if (scroller.scrollHeight > scroller.clientHeight * 1.6) {
            scroller.scrollTop = scroller.clientHeight * 0.85;
            await settle();
            await shot(`conv${index}-mid`, layout);
          }
          scroller.scrollTop = scroller.scrollHeight;
          await settle();
          await shot(`conv${index}-end`, layout);
          const translation = panel.root.querySelector('.rc-translation');
          if (translation) {
            translation.scrollIntoView({ block: 'start' });
            await settle();
            await shot(`conv${index}-translation`, layout);
          }
        }
        if (sessions.length > 1) {
          await open(primary, 0);
          await setLayout(environment, window, panel.root, layout, wait);
        }
      });
    if (views.has('menus'))
      await step('menus', async () => {
        panel.root.querySelector('.rc-quick-button').click();
        await settle();
        await shot('quick-menu', layout);
        panel.root.querySelector('.rc-quick-button').click();
        panel.modelMenu.button.click();
        await until(() => panel.root.querySelector('.rc-model-option'), 'Models visible', 30000);
        await settle();
        await shot('models', layout);
        panel.modelMenu.button.click();
        // Second service with a working key: seed its catalog in memory only.
        const second = app.store.configuration().providers.find((entry) => entry.type !== 'codex');
        if (second) {
          const signature = catalogKey(second);
          const previous = app.models.catalogs.get(signature);
          app.models.catalogs.set(signature, {
            models: [
              { model: 'deepseek-chat', displayName: 'deepseek-chat' },
              { model: 'deepseek-reasoner', displayName: 'deepseek-reasoner' },
            ],
          });
          panel.modelMenu.button.click();
          await until(() => panel.root.querySelector('.rc-menu-label'), 'Two groups', 10000);
          await settle();
          await shot('models-two', layout);
          panel.modelMenu.button.click();
          if (previous) app.models.catalogs.set(signature, previous);
          else app.models.catalogs.delete(signature);
        }
        if (views.has('many')) {
          // Four extra services: working (catalog seeded in memory), no key, bad key,
          // and an endpoint that never answers. The menu must open at once regardless.
          const configuration = app.store.configuration();
          const extra = [
            ['e2e-ok', '可用服务', 'https://api.deepseek.com', 'deepseek'],
            ['e2e-nokey', '没有密钥', 'https://api.moonshot.cn/v1', 'openai'],
            ['e2e-badkey', '密钥无效', 'https://api.deepseek.com/v1', 'deepseek'],
            ['e2e-slow', '接口超时', 'https://10.255.255.1/v1', 'openai'],
          ];
          for (const [id, name, baseURL, type] of extra)
            if (!configuration.providers.some((entry) => entry.id === id))
              configuration.providers.push({
                id,
                name,
                type,
                baseURL,
                model: id + '-model',
                context: 32000,
                vision: false,
              });
          app.store.saveConfiguration(configuration);
          await app.secrets.set('e2e-ok', 'e2e-fake');
          await app.secrets.set('e2e-badkey', 'e2e-invalid-key');
          await app.secrets.set('e2e-slow', 'e2e-fake');
          const ok = configuration.providers.find((entry) => entry.id === 'e2e-ok');
          app.models.catalogs ||= new Map();
          app.models.catalogs.set(catalogKey(ok), {
            models: ['flash', 'pro', 'max', 'mini', 'nano'].map((name) => ({
              model: 'e2e-' + name,
              displayName: 'E2E ' + name,
            })),
          });
          const started = Date.now();
          panel.modelMenu.button.click();
          await until(() => panel.modelMenu.root.querySelector('.rc-model-option'), 'Menu', 3000);
          report.menuOpenMs = Date.now() - started;
          await shot('models-many-open', layout);
          await wait(17000);
          report.menuAfterCatalogs = {
            height: panel.modelMenu.root.getBoundingClientRect().height,
            panel: panel.root.getBoundingClientRect().height,
            scroll: panel.modelMenu.list.scrollHeight > panel.modelMenu.list.clientHeight,
            rows: panel.modelMenu.root.querySelectorAll('.rc-model-option').length,
          };
          await shot('models-many-later', layout);
          panel.modelMenu.button.click();
        }
        const input = panel.input;
        input.value = '这个效应量的置信区间为什么这么宽？会不会是样本量不够？';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        panel.addReference({
          text: 'Whiskers represent 95% confidence intervals around the group means.',
          pageIndex: 2,
          kind: 'original',
        });
        await settle();
        await shot('composer-filled', layout);
        panel.references = [];
        input.value = '';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        panel.renderBasis(panel.viewState);
      });
    if (views.has('panels'))
      await step('panels', async () => {
        if (sessions[0] && panel.documentId !== sessions[0].documentId) {
          await open(primary, 0);
          await setLayout(environment, window, panel.root, layout, wait);
        }
        const saved = panel.session.conversations;
        const turns = panel.session.turns;
        // Shown, never saved: two earlier conversations so the list has real rows.
        panel.session.conversations = [
          { id: 'a', createdAt: '2026-11-12T08:31:00Z', turns: turns.slice(0, 1) },
          { id: 'b', createdAt: '2026-11-13T14:05:00Z', turns: turns.slice(-2) },
        ];
        panel.showHistory();
        await settle();
        await shot('history', layout);
        panel.session.conversations = saved;
        panel.conversation.querySelector('.rc-history')?.remove();
        panel.showGlossary();
        await settle();
        await shot('glossary', layout);
        panel.root.querySelector('.rc-glossary')?.remove();
        panel.showError({
          code: 'connection',
          title: '连接中断',
          reason: '模型服务没有在 120 秒内返回结果。',
          action: '请检查网络或代理后重试。',
        });
        await settle();
        await shot('error', layout);
        panel.status.replaceChildren();
        if (panel.notes) {
          await panel.notes.open();
          await until(() => panel.notes.entries, 'Notes loaded', 15000).catch(() => {});
          await settle();
          await shot('notes', layout);
          panel.notes.close();
        }
        const session = sessions.find((entry) => entry.notebookDraft);
        if (session) {
          if (panel.documentId !== session.documentId) {
            await open(itemFor(session), 0);
            await setLayout(environment, window, panel.root, layout, wait);
          }
          await panel.notebook.open('annotations');
          await until(
            () => panel.notebook.prepared || panel.notebook.feedback.textContent,
            'Notebook prepared',
            20000,
          ).catch(() => {});
          panel.notebook.prepared ||= {
            session,
            snapshot: null,
            material: session.notebookDraft.material,
          };
          panel.notebook.draft = session.notebookDraft;
          panel.notebook.render();
          await settle();
          await shot('notebook', layout);
          panel.notebook.close();
        }
        panel.onboarding?.show();
        await settle();
        await shot('onboarding', layout);
        if (panel.onboarding) {
          panel.onboarding.root.querySelector('details')?.setAttribute('open', '');
          await settle();
          await shot('onboarding-api', layout);
          panel.onboarding.root.querySelector('details')?.removeAttribute('open');
          panel.onboarding.root.hidden = true;
          panel.root.classList.remove('rc-setup-active');
        }
        await open(specification, 1);
        await setLayout(environment, window, panel.root, layout, wait);
        await settle();
        await shot('empty', layout);
      });
    if (views.has('settings'))
      await step('settings', async () => {
        app.openSettings();
        const preferences = await until(
          () =>
            [...Services.wm.getEnumerator('zotero:pref')].find((entry) =>
              entry.document.querySelector('.rc-settings'),
            ),
          'Settings',
          20000,
        );
        preferences.browsingContext.prefersColorSchemeOverride = layout.theme;
        await wait(800);
        const filename = `settings-${layout.theme}.png`;
        report.screenshots.push({
          name: 'settings',
          filename,
          ...(await saveWindow(
            environment,
            preferences,
            PathUtils.join(config.runDirectory, 'screenshots', filename),
          )),
        });
        const row = preferences.document.querySelector('.rc-provider-row');
        row?.click();
        await wait(600);
        const expanded = `settings-provider-${layout.theme}.png`;
        report.screenshots.push({
          name: 'settings-provider',
          filename: expanded,
          ...(await saveWindow(
            environment,
            preferences,
            PathUtils.join(config.runDirectory, 'screenshots', expanded),
          )),
        });
        const rows = preferences.document.querySelectorAll('.rc-provider-row');
        rows[rows.length - 1]?.click();
        await wait(600);
        const api = `settings-api-${layout.theme}.png`;
        report.screenshots.push({
          name: 'settings-api',
          filename: api,
          ...(await saveWindow(
            environment,
            preferences,
            PathUtils.join(config.runDirectory, 'screenshots', api),
          )),
        });
        preferences.close();
        await wait(500);
      });
    if (views.has('popup'))
      await step('popup', async () => {
        if (panel.documentId !== `${specification.libraryID}-${specification.key}`)
          await open(specification, 1);
        await setLayout(environment, window, panel.root, layout, wait);
        const reader = panel.activeReader;
        const controls = createSelectionControls({
          ...context,
          reader,
          panel: panel.root,
          allowExpandedSelection: true,
        });
        await controls.select('accepting');
        await until(
          () => controls.root()?.dataset.complete === 'true',
          'Word popup complete',
          90000,
        ).catch(() => {});
        await settle();
        await shot('popup-word', layout);
        await controls.select('The requirement lasts through the accepting rising edge.');
        await until(
          () => controls.root()?.dataset.complete === 'true',
          'Sentence popup complete',
          90000,
        ).catch(() => {});
        await settle();
        await shot('popup-sentence', layout);
        const note = [...controls.root().querySelectorAll('button')].find(
          (button) =>
            button.textContent.trim() === '记笔记' ||
            button.getAttribute('aria-label') === '记笔记',
        );
        note?.click();
        await settle();
        await shot('popup-note', layout);
      });
  }
  await persist();
}
