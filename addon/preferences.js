// Zotero loads preference scripts before inserting the pane fragment, then dispatches load.
document.addEventListener(
  'load',
  function mountReadingSettings() {
    const root = document.getElementById('reading-companion-settings');
    if (!root) return;
    document.removeEventListener('load', mountReadingSettings, true);
    const application = Zotero['reading-companion@local'];
    try {
      application.mountSettings(document);
    } catch (error) {
      application.recordFailure(error, 'settings-load');
      root.textContent = '设置未能加载。请重新打开设置；仍失败时请查看插件诊断。';
    }
  },
  true,
);
