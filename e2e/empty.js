export async function runModelEmptyAcceptance(context) {
  const { openSettings, getPanel, click, change, field, until, assert, case_, matrix } = context;
  await case_('settings-routing-refresh', async () => {
    const window = await openSettings();
    const settings = window.document.getElementById('reading-companion-settings');
    settings.querySelector('[data-provider="codex"]').click();
    click(settings, '高级');
    change(field(settings, 'Codex 可执行文件'), '/missing/reading-companion-codex');
    click(settings, '测试连接');
    await until(
      () => settings.querySelector('[data-provider="codex"] [data-status="failed"]'),
      'Failed probe has a red status dot',
      10000,
    );
    await matrix('settings-failed', window, settings);
    click(settings, '新增服务商');
    change(field(settings, '显示名称'), '验收备用模型');
    change(field(settings, '模型 ID'), 'test-only');
    const shared = field(settings, '全部使用同一个');
    assert(
      [...shared.options].some((option) => option.textContent === '验收备用模型'),
      'New provider and renamed label immediately appear in shared model choices',
    );
    click(settings, '分别选择模型');
    change(field(settings, '划词翻译模型'), 'deepseek');
    assert(shared.value === '', 'Mixed routes do not misleadingly display one shared model');
    change(shared, 'codex');
    assert(
      ['问答模型', '翻译模型', '读图模型', '划词翻译模型'].every(
        (label) => field(settings, label).value === 'codex',
      ),
      'Shared selection updates all four purposes',
    );
    window.close();
  });
  await case_('model-empty-state', async () => {
    const panel = getPanel();
    change(field(panel, '用途'), 'ask');
    const input = panel.querySelector('textarea');
    input.value = '这一页的核心观点是什么？';
    click(panel, '发送');
    await until(
      () => /未找到 Codex/u.test(panel.querySelector('.rc-empty')?.textContent || ''),
      'Dedicated missing model state',
      20000,
    );
    assert(
      panel.querySelectorAll('.rc-empty button:not([hidden])').length === 1,
      'Missing model state has exactly one action',
    );
    assert(!panel.querySelector('.rc-status').textContent, 'No duplicate bottom error');
    assert(input.value.includes('核心观点'), 'Unsent input remains available for retry');
    await matrix('model-empty');
    click(panel.querySelector('.rc-empty'), '打开模型设置');
    const window = await openSettings(false);
    const settings = window.document.getElementById('reading-companion-settings');
    settings.querySelector('[data-provider="codex"]').click();
    click(settings, '高级');
    change(field(settings, 'Codex 可执行文件'), '');
    window.close();
  });
}

export async function runScanEmptyAcceptance(context) {
  const { open, scan, getPanel, click, field, until, assert, case_, matrix, readSession } = context;
  await case_('scan-empty-state', async () => {
    await open(scan, 0);
    const panel = getPanel();
    panel.querySelector('textarea').value = '保留这条尚未发送的问题';
    click(panel, '翻译本页');
    await until(
      () => /本页没有文本层/u.test(panel.querySelector('.rc-empty')?.textContent || ''),
      'Dedicated scan state',
      20000,
    );
    await until(() => field(panel, '用途').value === 'ask', 'Quick action resets to ask', 3000);
    assert((await readSession()).turns.length === 0, 'Scan error does not create a model turn');
    assert(
      panel.querySelectorAll('.rc-empty button:not([hidden])').length === 1,
      'Scan state has exactly one action',
    );
    assert(
      panel.querySelector('textarea').value === '保留这条尚未发送的问题',
      'Quick translation preserves unsent question',
    );
    await matrix('scan-empty');
  });
}
