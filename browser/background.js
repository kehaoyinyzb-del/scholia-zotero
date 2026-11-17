const extensionAPI = globalThis.browser || chrome;
const clientOrigin = extensionAPI.runtime.getURL('').replace(/\/$/u, '');
const pendingSaves = new Map();

async function localRequest(endpoint, data, pairing = '') {
  const { port } = await extensionAPI.storage.local.get({ port: 23129 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/reading-companion/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Zotero-Connector-API-Version': '3',
        'X-Reading-Companion-Client': clientOrigin,
        ...(pairing ? { 'X-Reading-Companion-Token': pairing } : {}),
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Zotero 未接受请求，请检查配对设置。');
    return result;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Zotero 连接超时。请检查端口后重试，任务标识会保留。');
    }
    if (error instanceof TypeError) {
      throw new Error('无法连接 Zotero。请启动隔离实例，并检查扩展设置中的端口。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function canonicalPage(address) {
  const url = new URL(address);
  url.hash = '';
  for (const parameter of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/u.test(parameter)) url.searchParams.delete(parameter);
  }
  return url.href;
}

async function savePage(tab) {
  if (!/^https?:/u.test(tab.url || '')) {
    throw new Error('请打开论文详情页。浏览器内置页和 PDF 查看器无法提取网页。');
  }
  const key = canonicalPage(tab.url);
  if (pendingSaves.has(key)) return pendingSaves.get(key);
  const pending = captureAndSave(tab);
  pendingSaves.set(key, pending);
  try {
    return await pending;
  } finally {
    pendingSaves.delete(key);
  }
}

async function captureAndSave(tab) {
  const [injection] = await extensionAPI.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const documentCopy = document.documentElement.cloneNode(true);
      documentCopy
        .querySelectorAll(
          'script,iframe,input,textarea,select,[contenteditable],#reading-companion-host',
        )
        .forEach((node) => node.remove());
      return { url: location.href, html: documentCopy.outerHTML };
    },
  });
  const { port } = await extensionAPI.storage.local.get({ port: 23129 });
  const key = `job:${port}:${canonicalPage(injection.result.url)}`;
  const existing = await extensionAPI.storage.local.get(key);
  const identifier = existing[key] || crypto.randomUUID();
  await extensionAPI.storage.local.set({ [key]: identifier });
  return localRequest('save', { ...injection.result, id: identifier });
}

async function fetchPDF(address) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(address, { credentials: 'include', signal: controller.signal });
    if (!response.ok || Number(response.headers.get('content-length')) > 20e6) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 20e6) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) return null;
    let binary = '';
    for (let position = 0; position < bytes.length; position += 8192) {
      binary += String.fromCharCode(...bytes.subarray(position, position + 8192));
    }
    return btoa(binary);
  } finally {
    clearTimeout(timer);
  }
}

async function supplement(identifier) {
  const job = await localRequest('status', { id: identifier });
  for (const url of job.pdfURLs) {
    try {
      const base64 = await fetchPDF(url);
      if (base64) return await localRequest('attach', { id: identifier, url, base64 });
    } catch {
      // Try the next translator-provided PDF location without creating another parent.
    }
  }
  return { ...job, message: '已保存条目，未取得 PDF。请确认访问权限后重试补存。' };
}

async function handleMessage(message, sender) {
  if (sender.id !== extensionAPI.runtime.id) throw new Error('不支持的请求来源。');
  if (message.type === 'pair') {
    if (sender.url !== extensionAPI.runtime.getURL('options.html')) {
      throw new Error('请从扩展设置完成配对。');
    }
    const port = Number(message.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口无效。');
    await extensionAPI.storage.local.set({ port });
    return localRequest('pair', {}, message.pairing);
  }
  if (message.type === 'save') {
    const tab =
      sender.tab || (await extensionAPI.tabs.query({ active: true, currentWindow: true }))[0];
    return savePage(tab);
  }
  if (message.type === 'supplement') return supplement(message.id);
  if (['status', 'open', 'ping'].includes(message.type)) {
    return localRequest(message.type, { id: message.id });
  }
  throw new Error('不支持的请求。');
}

extensionAPI.runtime.onMessage.addListener((message, sender, reply) => {
  handleMessage(message, sender).then(
    (result) => reply({ ok: true, result }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});
