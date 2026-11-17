const extensionAPI = globalThis.browser || chrome;
const status = document.getElementById('status');
const save = document.getElementById('save');
const open = document.getElementById('open');
let job;

async function request(type) {
  const response = await extensionAPI.runtime.sendMessage({ type, id: job?.id });
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

save.addEventListener('click', async () => {
  save.disabled = true;
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
  } catch (error) {
    status.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});
open.addEventListener('click', () =>
  request('open').catch((error) => {
    status.textContent = error.message;
  }),
);
document.getElementById('settings').addEventListener('click', () => {
  extensionAPI.runtime.openOptionsPage();
});
