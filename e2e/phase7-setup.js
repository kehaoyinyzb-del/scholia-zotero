import { runSettingsControls } from './phase10.js';
import { saveWindow, setLayout } from './screenshots.js';

export async function runSetupAcceptance(context) {
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
  const { Zotero, IOUtils, PathUtils } = environment;
  const app = Zotero['reading-companion@local'];
  const initial = app.store.configuration();
  report.existingCodexDetected = Boolean(await app.models.executable(initial.providers[0]));
  initial.providers[0].path = PathUtils.join(config.runDirectory, 'missing-codex');
  app.store.saveConfiguration(initial);
  await open(specification, 0);
  const workspace = app.workspaces.get(window);
  const panel = workspace.panel;
  const onboarding = panel.onboarding;
  const shot = async (name) => {
    await setLayout(environment, window, panel.root, { theme: 'light', width: 380 }, wait);
    const filename = name + '.png';
    const image = await saveWindow(
      environment,
      window,
      PathUtils.join(config.runDirectory, 'screenshots', filename),
    );
    report.screenshots.push({ name, filename, ...image });
    await persist();
  };
  await case_('没有 Codex 的首次引导', async () => {
    await until(
      () => !onboarding.root.hidden && !onboarding.login.disabled,
      'Missing CLI onboarding',
    );
    assert(!panel.input.getClientRects().length, 'First use shows setup rather than empty chat');
    await shot('first-use');
  });
  if (config.only === 'phase7-download') {
    await case_('原生下载、校验与官方登录启动', async () => {
      const launchURL = Zotero.launchURL;
      Zotero.launchURL = (url) => {
        report.loginOrigin = new URL(url).origin;
        window.setTimeout(() => onboarding.controller.abort(), 300);
      };
      try {
        const runtime = app.models.runtime;
        const path = await runtime.download(
          runtime.platform().asset,
          (text) => {
            onboarding.status.textContent = text;
          },
          new window.AbortController().signal,
        );
        app.setup.save({ ...app.setup.provider(), path }, false);
        report.downloadConsent = 'Download method tested directly; confirmation UI not exercised';
        await onboarding.signIn();
        assert(report.loginOrigin === 'https://auth.openai.com', 'Official OAuth start succeeds');
        assert(await IOUtils.exists(path), 'Verified binary installed in owned data');
        assert(
          await IOUtils.exists(PathUtils.join(PathUtils.parent(path), 'LICENSE')),
          'Distribution license accompanies managed binary',
        );
        await onboarding.check();
        assert(
          !onboarding.root.hidden && !onboarding.status.textContent,
          'Cancellation keeps home unsigned',
        );
        report.loginBoundary = 'Official start and cancellation only; browser launch intercepted';
        await shot('downloaded-login');
        await setLayout(environment, window, panel.root, { theme: 'dark', width: 380 }, wait);
        const filename = 'onboarding-dark.png';
        const image = await saveWindow(
          environment,
          window,
          PathUtils.join(config.runDirectory, 'screenshots', filename),
        );
        report.screenshots.push({ name: 'onboarding-dark', filename, ...image });
      } finally {
        Zotero.launchURL = launchURL;
      }
    });
    return;
  }
  await case_('固定版本 Codex，隔离配置未登录', async () => {
    const path = app.models.runtime.managedPath();
    await IOUtils.makeDirectory(PathUtils.parent(path), {
      ignoreExisting: true,
      permissions: 0o700,
    });
    await IOUtils.copy(config.codexFixture, path);
    await IOUtils.setPermissions(path, 0o700);
    app.setup.save({ ...app.setup.provider(), path }, false);
    await onboarding.check();
    assert(
      !onboarding.root.hidden && !onboarding.status.textContent,
      'Empty isolated Codex home requires login',
    );
    const environment = await app.models.runtime.processEnvironment(path);
    assert(
      environment.CODEX_HOME.startsWith(config.data),
      'CLI authentication belongs only to disposable data',
    );
    await shot('not-signed-in');
  });

  await case_('ChatGPT 登录按钮启动官方授权并取消', async () => {
    const launch = Zotero.launchURL;
    try {
      Zotero.launchURL = (url) => {
        report.loginOrigin = new URL(url).origin;
      };
      onboarding.login.click();
      await until(() => report.loginOrigin, 'Official login URL');
      assert(report.loginOrigin === 'https://auth.openai.com', 'Official authorization origin');
      onboarding.cancel.click();
      await until(() => !onboarding.login.disabled, 'Login cancelled');
      report.loginBoundary =
        'Native login button and cancellation; browser authorization not completed';
    } finally {
      Zotero.launchURL = launch;
    }
  });

  const testAPI = app.setup.testAPI.bind(app.setup);
  app.setup.testAPI = async (...args) => {
    try {
      return await testAPI(...args);
    } catch (error) {
      report.apiFailure = {
        name: error.name,
        code: error.code,
        message: error.message,
        abortAny: typeof window.AbortSignal.any,
      };
      await persist();
      throw error;
    }
  };
  let mode = 401;
  const endpointPath = '/reading-companion-e2e-model';
  const Endpoint = function () {};
  Endpoint.prototype = {
    supportedMethods: ['POST', 'GET'],
    supportedDataTypes: ['application/json'],
    async init(request) {
      report.mockRequests = (report.mockRequests || 0) + 1;
      if (mode !== 200)
        return [
          mode,
          'application/json',
          JSON.stringify({
            error: {
              code: mode === 401 ? 'invalid_api_key' : 'rate_limit_exceeded',
              message: 'Synthetic test response',
            },
          }),
        ];
      if (!request.data?.messages)
        return [200, 'application/json', JSON.stringify({ data: [{ id: 'deepseek-flash' }] })];
      const messages = JSON.stringify(request.data.messages);
      const content = messages.includes('CONNECTION_OK')
        ? 'CONNECTION_OK'
        : messages.includes('图像主体是什么颜色')
          ? '红色'
          : JSON.stringify({
              answer: '这是本地假服务生成的首轮回答。',
              claims: [{ text: '这是本地假服务生成的首轮回答。', kind: 'text', citations: [] }],
              uncertainties: [],
            });
      return [
        200,
        'text/event-stream',
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      ];
    },
  };
  Zotero.Server.Endpoints[endpointPath] = Endpoint;
  const originalFetch = window.fetch;
  const originalCopy = Zotero.Utilities.Internal.copyTextToClipboard;
  let diagnostic;
  window.fetch = (url, options) => {
    if (String(url).startsWith('https://api.deepseek.com'))
      return originalFetch.call(window, `http://127.0.0.1:${config.port}${endpointPath}`, {
        ...options,
        headers: { ...options?.headers, 'Zotero-Allowed-Request': 'true' },
      });
    return originalFetch.call(window, url, options);
  };
  Zotero.Utilities.Internal.copyTextToClipboard = (text) => {
    diagnostic = text;
  };
  try {
    const apiDetails = [...onboarding.root.querySelectorAll('details')][0];
    apiDetails.open = true;
    onboarding.preset.value = 'deepseek';
    onboarding.preset.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (const status of [401, 429, 200]) {
      await case_(`API 本地响应 ${status}`, async () => {
        mode = status;
        const previous = onboarding.controller;
        onboarding.key.value = 'e2e-synthetic-secret';
        onboarding.key.dispatchEvent(new window.Event('input', { bubbles: true }));
        await until(
          () =>
            onboarding.root.hidden ||
            (onboarding.controller !== previous &&
              !onboarding.login.disabled &&
              !onboarding.apiStatus.textContent.includes('正在测试')),
          `API ${status}`,
        );
        assert(
          status === 200
            ? onboarding.root.hidden
            : onboarding.apiStatus.textContent.includes(status === 401 ? '密钥' : '频繁'),
          `API ${status} feedback: ${onboarding.apiStatus.textContent}`,
        );
        if (status !== 200) {
          onboarding.apiStatus.querySelector('[data-diagnostics]').click();
          assert(
            !diagnostic.includes('e2e-synthetic-secret') && !diagnostic.includes(config.data),
            'Diagnostics omit keys and local paths',
          );
          assert(JSON.parse(diagnostic).status === status, 'Diagnostics retain raw HTTP status');
          await shot('api-' + status);
        }
      });
    }
    await case_('新 profile 首次回答与再次打开', async () => {
      panel.input.value = '测试第一次提问';
      panel.input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await wait(800);
      panel.send.click();
      await until(() => panel.session.turns.at(-1)?.answer, 'First API answer');
      assert(
        panel.session.turns.at(-1).state === 'complete',
        'Normal question entry works after setup',
      );
      workspace.hide();
      workspace.show();
      assert(onboarding.root.hidden, 'Completed onboarding stays closed');
      report.firstUse = {
        provider: 'local mock API',
        entryActions: ['展开 API 密钥', '粘贴密钥', '输入问题并发送'],
        installation: 'XPI installed by isolated launcher; installer clicks are not counted',
      };
      await shot('first-answer');
    });
    await runSettingsControls(context);
  } finally {
    window.fetch = originalFetch;
    Zotero.Utilities.Internal.copyTextToClipboard = originalCopy;
    delete Zotero.Server.Endpoints[endpointPath];
  }
}
