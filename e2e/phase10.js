import { apiKeyId } from '../src/domain/configuration.js';
import { saveWindow, hashBytes } from './screenshots.js';

export async function runPhase10(context) {
  const {
    environment,
    config,
    window,
    open,
    specification,
    library,
    until,
    assert,
    case_,
    report,
    persist,
    click,
  } = context;
  const { Zotero, IOUtils, PathUtils, ChromeUtils } = environment;
  const app = Zotero['reading-companion@local'];
  if (config.only === 'phase10-notes-finish') {
    await case_('已保存笔记读回、原生导出与列表删除', async () => {
      const id = await Zotero.DB.valueQueryAsync(
        'SELECT parentItemID FROM itemAnnotations GROUP BY parentItemID HAVING COUNT(*)>=3',
      );
      const attachment = await Zotero.Items.getAsync(id);
      await attachment.loadAllData();
      await open(attachment, 1);
      const panel = app.workspaces.get(window).panel;
      await until(() => !panel.root.classList.contains('rc-setup-active'), 'Chat ready');
      const session = panel.session;
      const organized = Zotero.Items.get(session.notebookNoteID);
      assert(
        organized?.getNote().includes('第二句保留 2.50 V 与原话。'),
        'Organized note retains original words',
      );
      const entries = await app.readingNotes.list(id);
      assert(entries.length >= 4, 'Three annotations and saved answer survive');
      const before = await Zotero.DB.valueQueryAsync('SELECT MAX(itemID) FROM itemNotes');
      click(panel.root, '笔记');
      await until(() => panel.notes.entries?.length >= 4, 'Notes list');
      click(panel.notes.root, '导出');
      const exported = await until(async () => {
        const value = await Zotero.DB.valueQueryAsync('SELECT MAX(itemID) FROM itemNotes');
        return value > before ? Zotero.Items.get(value) : null;
      }, 'Exported native note');
      assert(exported.getNote().includes('第二句保留 2.50 V 与原话。'), 'Export retains words');
      const editor = await until(
        () =>
          [...environment.Services.wm.getEnumerator(null)].find(
            (entry) => entry !== window && entry.document.querySelector('note-editor'),
          ),
        'Export editor',
      );
      editor.close();
      window.focus();
      const doomed = entries.find((entry) => entry.annotation && !entry.comment);
      assert(doomed, 'Disposable empty-comment highlight');
      const services = app.environment.Services;
      app.environment.Services = new Proxy(services, {
        get: (target, name) => (name === 'prompt' ? { confirm: () => true } : target[name]),
      });
      try {
        click(panel.notes.list.querySelector(`[data-note-id="${doomed.id}"]`), '删除');
        await until(() => !Zotero.Items.get(doomed.id), 'Annotation erased');
        await until(
          () =>
            !panel.activeReader._internalReader._state.annotations.some(
              (entry) => entry.id === doomed.key,
            ),
          'Native PDF highlight removed',
        );
      } finally {
        app.environment.Services = services;
      }
      report.noteFinish = {
        organizedNote: organized.id,
        exportedNote: exported.id,
        deletedAnnotation: doomed.key,
        confirmation: 'accepted by harness',
      };
    });
    return;
  }
  await open(specification, 0);
  const panel = app.workspaces.get(window).panel;
  await until(() => !panel.root.classList.contains('rc-setup-active'), 'Chat ready');
  report.scope = config.only;
  if (config.only === 'phase10-upgrade-seed') {
    await case_('0.8.0 中写入升级样本', async () => {
      assert(app.version === '0.8.0' || report.installation.version === '0.8.0', 'Old package');
      const session = panel.session;
      session.glossary = [{ source: 'RESET_N', translation: '低有效复位', context: '' }];
      await app.store.saveSession(session);
      await app.secrets.set('phase10-upgrade', 'synthetic-upgrade-secret');
      const settings = app.store.configuration();
      settings.translation.language = 'English';
      app.store.saveConfiguration(settings);
      report.upgradeFixture = { glossary: session.glossary, syntheticKeyStored: true };
    });
    return;
  }
  if (config.only === 'phase10-upgrade') {
    await case_('0.8.0 密钥、配置与术语表读回', async () => {
      assert(
        (await app.secrets.get('phase10-upgrade')) === 'synthetic-upgrade-secret',
        'Login Manager key survives',
      );
      assert(app.store.configuration().translation.language === 'English', 'Settings survive');
      const sessions = await Promise.all(
        config.legacySessions.map((entry) => app.store.session(entry.documentId)),
      );
      assert(
        sessions.some((entry) => JSON.stringify(entry.glossary).includes('RESET_N')),
        'Glossary survives',
      );
      assert(
        sessions.some((entry) => entry.turns.length),
        'Nonempty old conversation survives',
      );
      report.upgrade = {
        from: '0.8.0',
        key: 'synthetic key matched; value omitted',
        sessions: sessions.length,
      };
    });
    await case_('停用、重新启用及卸载清理', async () => {
      const { AddonManager } = ChromeUtils.importESModule(
        'resource://gre/modules/AddonManager.sys.mjs',
      );
      const addon = await AddonManager.getAddonByID('reading-companion@local');
      await addon.disable();
      await until(() => !Zotero['reading-companion@local'], 'Disabled app removed');
      assert(!window.document.querySelector('.rc-workspace'), 'Workspace removed');
      assert(
        app.panels.size === 0 && app.workspaces.size === 0 && app.windowResources.size === 0,
        'Owned views/styles cleared',
      );
      assert(app.models.active.size === 0, 'Requests cleared');
      await addon.enable();
      await until(() => Zotero['reading-companion@local'], 'Re-enabled app');
      const restarted = Zotero['reading-companion@local'];
      assert(restarted !== app, 'Fresh application instance');
      await open(specification, 0);
      report.beforeUninstallChecksum = hashBytes(
        environment,
        await IOUtils.read(
          PathUtils.join(
            config.runDirectory,
            'profile',
            'extensions',
            'reading-companion@local.xpi',
          ),
        ),
      );
      assert(report.beforeUninstallChecksum === config.checksum, 'Original bytes before uninstall');
      await addon.uninstall();
      await until(() => !Zotero['reading-companion@local'], 'Uninstalled app removed');
      assert(
        restarted.panels.size === 0 && restarted.workspaces.size === 0,
        'No remaining workspace after uninstall',
      );
      assert(
        !Object.keys(Zotero.Server.Endpoints).some((key) => key.startsWith('/reading-companion/')),
        'HTTP endpoints removed',
      );
      report.expectedUninstall = true;
      report.lifecycle =
        'AddonManager disable -> enable -> uninstall, native app/views/requests/endpoints checked';
    });
    return;
  }
  const send = (text) => {
    panel.input.value = text;
    panel.input.dispatchEvent(new window.Event('input', { bubbles: true }));
    click(panel.root, '发送');
  };
  const completed = async (before) =>
    until(
      () => {
        const turn = panel.session.turns.at(-1);
        if (!turn || turn.id === before) return null;
        if (turn.state === 'failed') throw new Error(JSON.stringify(turn.error));
        return turn.answer ? turn : null;
      },
      'Real answer',
      600000,
    );
  await case_('真实流式、生成中翻页与停止', async () => {
    send('请详细解释这一页，逐条说明条件和原因，至少十个段落。');
    const streaming = await until(
      () => panel.session.turns.findLast((turn) => turn.state === 'streaming' && turn.preview),
      'Visible real stream',
      120000,
    );
    assert(panel.root.querySelector('.rc-stream')?.textContent.length > 0, 'Stream displayed');
    const previewLength = streaming.preview.length;
    const navigation = panel.activeReader.navigate({ pageIndex: 2 });
    assert(streaming.snapshot.pageIndex === 0, 'Streaming evidence stays on sent page');
    click(panel.root, '停止生成');
    await navigation;
    await until(() => streaming.state === 'cancelled', 'Stopped turn');
    report.streaming = {
      id: streaming.id,
      frozenPage: streaming.snapshot.pageIndex,
      previewLength,
    };
  });
  await case_('数学回答、复制原文与存为笔记', async () => {
    const before = panel.session.turns.at(-1)?.id;
    send('用 $Y=PX$ 说明矩阵乘法，写出元素公式，并说明 DATA[7:0] 不得改变。请简短。');
    const turn = await completed(before);
    await until(() => panel.root.querySelector('.rc-formula math'), 'Native MathML');
    const filename = 'phase10-math.png';
    const image = await saveWindow(
      environment,
      window,
      PathUtils.join(config.runDirectory, 'screenshots', filename),
    );
    report.screenshots.push({ name: 'phase10-math', filename, ...image });
    let copied;
    const originalCopy = Zotero.Utilities.Internal.copyTextToClipboard;
    Zotero.Utilities.Internal.copyTextToClipboard = (text) => {
      copied = text;
    };
    try {
      click(panel.root.querySelector(`[data-turn-id="${turn.id}"]`), '复制回答');
    } finally {
      Zotero.Utilities.Internal.copyTextToClipboard = originalCopy;
    }
    assert(copied.startsWith(turn.answer.text), 'Copy uses model source string');
    const prior = new Set((await app.readingNotes.list(specification.id)).map((entry) => entry.id));
    click(panel.root.querySelector(`[data-turn-id="${turn.id}"]`), '存为笔记');
    await until(
      async () =>
        (await app.readingNotes.list(specification.id)).some((entry) => !prior.has(entry.id)),
      'Native saved answer',
    );
    await IOUtils.writeJSON(PathUtils.join(config.runDirectory, 'math-answer.json'), turn);
  });
  await case_('快捷操作、总结重新生成与历史删除', async () => {
    for (const label of ['总结本页', '总结本章', '总结全文', '讲懂这段']) {
      const before = panel.session.turns.at(-1)?.id;
      click(panel.root, '快捷');
      click(panel.root, label);
      if (label === '总结本章') {
        const result = await until(
          () =>
            panel.session.turns.at(-1)?.id !== before
              ? panel.session.turns.at(-1)
              : panel.status.textContent.includes('无法定位本章'),
          'Chapter action result',
        );
        if (result === true || result.error?.code === 'summary-chapter') {
          report.chapter = 'PDF has no outline; UI reported chapter unavailable';
          continue;
        }
      }
      const turn = await completed(before);
      if (label === '总结全文') {
        click(panel.root.querySelector(`[data-turn-id="${turn.id}"]`), '重新生成');
        await completed(turn.id);
      }
    }
    click(panel.root, '新对话');
    await until(() => panel.session.turns.length === 0, 'New chat');
    click(panel.root, '历史对话');
    const count = panel.session.conversations.length;
    click(panel.root.querySelector('.rc-history-row'), '删除这段历史对话');
    await until(() => panel.session.conversations.length === count - 1, 'History deleted');
  });
  await case_('文献库右键全文总结', async () => {
    window.Zotero_Tabs.select('zotero-pane');
    await window.ZoteroPane.selectItem(library.parentItemID);
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
        window.document.querySelector('.rc-library-summary')?.textContent.includes('已存为子笔记'),
      'Library summary saved',
      600000,
    );
    assert(
      !Zotero.Reader._readers.some((entry) => entry.itemID === library.id),
      'Unopened PDF summarized',
    );
    report.librarySummary = window.document.querySelector('.rc-library-summary').textContent;
  });
  await persist();
}

export async function runSettingsControls(context) {
  const { environment, window, until, wait, assert, case_, click, report } = context;
  const { Zotero } = environment;
  const app = Zotero['reading-companion@local'];
  await case_('新版设置控件与自动测试密钥', async () => {
    app.openSettings();
    const preferences = await until(
      () =>
        [...environment.Services.wm.getEnumerator('zotero:pref')].find((entry) =>
          entry.document.querySelector('.rc-settings'),
        ),
      'Settings',
    );
    const root = preferences.document.querySelector('.rc-settings');
    const field = (label) =>
      [...root.querySelectorAll('label')]
        .find((node) => [...node.childNodes].some((child) => child.textContent === label))
        ?.querySelector('input,select');
    const change = (label, value) => {
      const node = field(label);
      assert(node, 'Settings field: ' + label);
      if (node.type === 'checkbox') node.checked = value;
      else node.value = value;
      node.dispatchEvent(new preferences.Event('change', { bubbles: true }));
    };
    click(root, '新增服务商');
    const id = root.querySelector('.rc-provider-row[aria-expanded="true"]').dataset.provider;
    assert(
      ['智谱 GLM', 'DeepSeek', '通义千问', 'Kimi'].every((name) =>
        [...field('服务商').options].some((option) => option.textContent === name),
      ),
      'Four short provider names',
    );
    change('服务商', 'deepseek');
    change('显示名称', 'API 功能验收');
    click(root.querySelector('.rc-provider-editor'), '高级');
    change('上下文长度', '128000');
    change('超时秒数', '180');
    const keyId = apiKeyId(app.store.configuration().providers.find((entry) => entry.id === id));
    const secret = root.querySelector('[aria-label="API 密钥"]');
    secret.value = 'e2e-settings-secret';
    secret.dispatchEvent(new preferences.Event('input', { bubbles: true }));
    await until(
      async () => (await app.secrets.get(keyId)) === 'e2e-settings-secret',
      'Pasted key automatically tested and saved',
    );
    assert(
      app.store.configuration().providers.find((entry) => entry.id === id).probe.text,
      'Successful probe persisted',
    );
    click(root, '测试连接');
    click(root, '取消测试');
    await until(
      () =>
        [...root.querySelectorAll('button')].find((node) => node.textContent === '取消测试').hidden,
      'Probe cancelled',
    );
    change('默认模型', '__custom__');
    const custom = root.querySelector('[placeholder="输入模型 ID"]');
    custom.value = 'deepseek-flash';
    custom.dispatchEvent(new preferences.Event('change', { bubbles: true }));
    change('全部使用同一个', id);
    click(root, '不同任务用不同的服务商');
    click(root, '分别选择');
    for (const label of ['提问和总结', '翻译整页', '看图', '选中文字翻译']) change(label, id);
    change('目标语言', 'English');
    for (const value of ['off', 'click', 'auto']) change('划词翻译', value);
    change('高亮评论中保存译文', false);
    change('高亮评论中保存译文', true);
    change('保存位置', field('保存位置').options[0].value);
    let copied;
    const copy = Zotero.Utilities.Internal.copyTextToClipboard;
    Zotero.Utilities.Internal.copyTextToClipboard = (text) => {
      copied = text;
    };
    try {
      click(root, '复制浏览器配对码');
      await until(() => copied, 'Pairing code copied');
    } finally {
      Zotero.Utilities.Internal.copyTextToClipboard = copy;
    }
    change('默认模型', field('默认模型').options[0].value);
    await wait(100);
    const effort = root.querySelector('[aria-label="思考深度"]');
    if (effort) {
      effort.value = effort.options[0].value;
      effort.dispatchEvent(new preferences.Event('change', { bubbles: true }));
    }
    click(root, '删除密钥');
    await until(async () => !(await app.secrets.get(keyId)), 'Key removed');
    secret.value = 'e2e-settings-secret';
    click(root, '保存密钥');
    await until(
      async () => (await app.secrets.get(keyId)) === 'e2e-settings-secret',
      'Explicit save also tests key',
    );
    click(root, '打开本篇术语表');
    const panel = app.workspaces.get(window).panel;
    await until(() => panel.root.querySelector('.rc-glossary'), 'Glossary from settings');
    const glossary = panel.root.querySelector('.rc-glossary');
    const inputs = glossary.querySelectorAll('input');
    inputs[0].value = 'RESET_N';
    inputs[1].value = '低有效复位';
    inputs[2].value = 'signal';
    click(glossary, '保存纠正');
    await until(
      () => panel.session.glossary.some((entry) => entry.source === 'RESET_N'),
      'Correction saved',
    );
    click(glossary, '收起术语表');
    report.settingsControls =
      'Provider add/type/name/model/key auto-probe/save/delete/test/cancel, ' +
      'advanced values, routing, default model/effort, translation, destination, pairing, glossary';
    window.focus();
  });
}
