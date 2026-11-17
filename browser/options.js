const extensionAPI = globalThis.browser || chrome;
const status = document.getElementById('status');
extensionAPI.storage.local.get({ port: 23129 }).then((configuration) => {
  document.getElementById('port').value = configuration.port;
});
document.getElementById('save').addEventListener('click', async () => {
  const pairing = document.getElementById('pairing');
  const port = Number(document.getElementById('port').value);
  try {
    const response = await extensionAPI.runtime.sendMessage({
      type: 'pair',
      port,
      pairing: pairing.value.trim(),
    });
    status.textContent = response.ok ? '配对成功，可以保存文献。' : response.error;
  } catch {
    status.textContent = '连接失败。请检查 Zotero 是否启动及端口是否正确。';
  } finally {
    pairing.value = '';
  }
});
