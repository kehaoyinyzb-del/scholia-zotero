import { saveWindow, setLayout } from './screenshots.js';

export async function runRealLogin(context) {
  const {
    environment,
    config,
    window,
    open,
    specification,
    until,
    wait,
    assert,
    case_,
    report,
    persist,
  } = context;
  const { Zotero, PathUtils } = environment;
  const app = Zotero['reading-companion@local'];
  const path = app.models.runtime.managedPath();
  app.setup.save({ ...app.setup.provider(), path });
  const processEnvironment = await app.models.runtime.processEnvironment(path);
  assert(processEnvironment.CODEX_HOME.startsWith(config.data), 'Fresh owned Codex home');
  const started = Date.now();
  report.loginSteps = [];
  const mark = async (step, result = 'completed') => {
    if (report.loginSteps.some((entry) => entry.step === step)) return;
    const elapsedMs = Date.now() - started;
    const durationMs = elapsedMs - (report.loginSteps.at(-1)?.elapsedMs || 0);
    report.loginSteps.push({
      step,
      result,
      durationMs,
      elapsedMs,
      at: new Date().toISOString(),
    });
    await persist();
  };
  await open(specification, 0);
  const panel = app.workspaces.get(window).panel;
  const onboarding = panel.onboarding;
  const screenshot = async (name) => {
    const filename = name + '.png';
    const image = await saveWindow(
      environment,
      window,
      PathUtils.join(config.runDirectory, 'screenshots', filename),
    );
    report.screenshots.push({ name, filename, ...image });
    await persist();
  };
  await setLayout(environment, window, panel.root, { theme: 'light', width: 380 }, wait);
  await mark('first-use-ready');
  await screenshot('real-login-ready');
  await case_('真人登录与浏览器回跳', async () => {
    await until(
      async () => {
        if (onboarding.controller) await mark('login-clicked');
        const text = onboarding.status.textContent;
        if (text.includes('下载')) await mark('download-started');
        if (text.includes('校验')) await mark('download-verifying');
        if (onboarding.loginURL) await mark('browser-login-opened');
        if (
          !onboarding.root.hidden &&
          !onboarding.login.disabled &&
          onboarding.root.querySelector('[data-diagnostics]')
        ) {
          await screenshot('real-login-error');
          throw new Error('Login failed; see screenshot and redacted diagnostics');
        }
        return onboarding.root.hidden;
      },
      'Human browser authorization',
      config.loginTimeout,
    );
    await mark('login-completed-chat-ready');
    const provider = await app.setup.available();
    assert(provider.type === 'codex' && provider.path === path, 'Managed Codex authenticated');
    await screenshot('real-login-connected');
  });
  if (report.cases.some((entry) => entry.state === 'failed')) {
    await mark('login-failed-or-timed-out', 'failed');
    return;
  }
  await case_('登录后自动发送第一问', async () => {
    panel.input.value = '用一句话说明这一页在讲什么，并给出原文出处。';
    panel.input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await mark('first-question-sent');
    panel.send.click();
    await until(
      () => {
        const turn = panel.session.turns.at(-1);
        if (turn?.state === 'failed') throw new Error('First question failed: ' + turn.error.code);
        return turn?.answer;
      },
      'First authenticated answer',
      180000,
    );
    await mark('first-answer-received');
    await screenshot('real-login-answer');
    report.firstAnswer = panel.session.turns.at(-1).answer;
    await persist();
  });
  if (report.cases.at(-1).state === 'failed') await mark('first-question-failed', 'failed');
}
