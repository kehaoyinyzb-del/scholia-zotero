(function installPageButton() {
  if (document.getElementById('reading-companion-host')) return;
  const metadata = document.querySelector('meta[name^="citation_"],meta[name="DC.title"]');
  if (!metadata && !/arxiv\.org\/abs|\/articles?\/|\/doi\//u.test(location.href)) return;
  const heading = document.querySelector('h1');
  if (!heading) return;
  const host = document.createElement('div');
  host.id = 'reading-companion-host';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = [
    ':host { display: block; margin-block: 8px; font: inherit; color-scheme: light dark; }',
    'button { font: inherit; cursor: pointer; }',
    'p { font: inherit; line-height: 1.6; margin-block: 4px; }',
    ':focus-visible { outline: 2px solid Highlight; outline-offset: 4px; }',
  ].join('\n');
  const save = document.createElement('button');
  save.textContent = '保存到 Zotero';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const open = document.createElement('button');
  open.textContent = '在 Zotero 中打开';
  open.hidden = true;
  const extensionAPI = globalThis.browser || chrome;
  let job;
  let dismissTimer;
  const request = async (type) => {
    const response = await extensionAPI.runtime.sendMessage({ type, id: job?.id });
    if (!response.ok) throw new Error(response.error);
    return response.result;
  };
  save.addEventListener('click', async () => {
    save.disabled = true;
    clearTimeout(dismissTimer);
    try {
      job = await request('save');
      status.textContent = job.message;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (['complete', 'partial', 'failed'].includes(job.state)) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        job = await request('status');
        status.textContent = job.message;
      }
      if (job.state === 'partial') job = await request('supplement');
      status.textContent = job.message;
      open.hidden = !job.itemID;
      if (job.state === 'complete') {
        dismissTimer = setTimeout(() => {
          status.textContent = '';
        }, 8000);
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      save.disabled = false;
      save.textContent = job?.state === 'partial' ? '重试补存 PDF' : '保存到 Zotero';
    }
  });
  open.addEventListener('click', async () => {
    try {
      await request('open');
    } catch (error) {
      status.textContent = error.message;
    }
  });
  shadow.append(style, save, status, open);
  heading.insertAdjacentElement('afterend', host);
})();
