import { saveWindow } from './screenshots.js';

// Replace only the two API transports. Exercise the installed XPI, Zotero Login Manager,
// real PDF reader, catalog, model preference, composer and streaming response handling.
export async function runModelChat({
  environment,
  config: launcher,
  report,
  window,
  open,
  specification,
  assert,
  until,
}) {
  const { Zotero, Services, PathUtils } = environment;
  const app = Zotero['reading-companion@local'];
  const config = app.store.configuration();
  config.providers = config.providers.filter((entry) => entry.type !== 'codex');
  for (const route of Object.keys(config.routes)) config.routes[route] = config.providers[0].id;
  app.store.saveConfiguration(config);
  const originalFetch = window.fetch;
  const sent = [];
  const selectedId = 'gpt-4.1-mini';
  const snapshots = Array.from({ length: 24 }, (_, index) => 'gpt-fixture-' + index);
  let release;
  let rejectChat = false;
  window.fetch = async (url, options) => {
    const { hostname, pathname } = new URL(url);
    const base = {
      'api.openai.com': '/v1',
      'generativelanguage.googleapis.com': '/v1beta/openai',
    }[hostname];
    if (!base) return originalFetch.call(window, url, options);
    const gemini = hostname === 'generativelanguage.googleapis.com';
    assert(options.headers.Authorization === 'Bearer fixture-' + hostname, 'Key scoped to host');
    if (pathname === base + '/models') {
      const ids = gemini
        ? ['models/gemini-3.8-flash', 'models/gemini-3.6-flash']
        : [
            'text-embedding-3-large',
            'gpt-5-mini',
            'gpt-5',
            'gpt-5.1',
            'gpt-5.2',
            ...snapshots,
            selectedId,
          ];
      return new window.Response(JSON.stringify({ data: ids.map((id) => ({ id })) }));
    }
    assert(pathname === base + '/chat/completions', 'Chat endpoint matches preset');
    const { messages, model } = JSON.parse(options.body);
    const prompt = messages.at(-1).content;
    let text;
    if (Array.isArray(prompt) && prompt[0].text.includes('颜色')) text = '红';
    else if (typeof prompt === 'string' && prompt.includes('CONNECTION_OK')) text = 'CONNECTION_OK';
    else {
      if (rejectChat) return new window.Response('{}', { status: 429 });
      sent.push(model);
      await new Promise((resolve) => (release = resolve));
      text = '{"answer":"回归测试回答"}';
    }
    const chunk = JSON.stringify({
      choices: [{ delta: { content: text }, finish_reason: 'stop' }],
    });
    return new window.Response('data: ' + chunk + '\n\ndata: [DONE]\n\n');
  };
  try {
    await open(specification, 0);
    const panel = app.workspaces.get(window).panel;
    const setup = panel.onboarding;
    for (const [id, host] of [
      ['openai', 'api.openai.com'],
      ['gemini', 'generativelanguage.googleapis.com'],
    ]) {
      setup.show();
      setup.preset.value = id;
      setup.preset.dispatchEvent(new window.Event('change'));
      setup.key.value = 'fixture-' + host;
      await setup.testAPI();
      assert(setup.root.hidden, 'Preset connection and key storage: ' + id);
    }
    const menu = panel.modelMenu;
    menu.button.click();
    await until(
      () => menu.list.querySelectorAll('button').length === 7 + snapshots.length,
      'Both full catalogs',
      5000,
    );
    assert(menu.list.scrollHeight > menu.list.clientHeight, 'Full catalog is scrollable');
    menu.search.value = '4.1';
    menu.search.dispatchEvent(new window.Event('input'));
    const found = menu.list.querySelectorAll('button');
    assert(found.length === 1 && found[0].textContent === selectedId, 'Older model searchable');
    found[0].click();
    assert(menu.root.hidden && menu.button.textContent.includes(selectedId), 'Choice closes menu');
    menu.button.click();
    assert(
      menu.list.querySelector('[aria-checked="true"]').textContent === selectedId,
      'Selected row',
    );
    menu.button.click();
    panel.input.value = '解释当前页';
    panel.input.dispatchEvent(new window.Event('input'));
    panel.send.click();
    assert(panel.input.value === '', 'Composer cleared before answer');
    panel.input.value = '下一条草稿';
    panel.input.dispatchEvent(new window.Event('input'));
    await until(() => release, 'Chat reached API fixture', 10000);
    assert(sent[0] === selectedId, 'Chosen model used for request');
    release();
    await until(() => panel.session.turns.at(-1)?.answer, 'Answer persisted', 5000);
    assert(panel.input.value === '下一条草稿', 'New draft survives completion');
    rejectChat = true;
    panel.input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert(panel.input.value === '', 'Enter clears draft on submission');
    await until(() => panel.input.value === '下一条草稿', 'Failed send restores draft', 5000);
    assert(panel.session.turns.at(-1).state === 'failed', 'Failure is recorded');
    const native = Zotero.Utilities.Internal.openPreferences('zotero-prefpane-general');
    try {
      const target = await until(() => {
        const ui = native.Zotero_Preferences;
        if (!ui?.panes?.get('zotero-prefpane-general')?.loaded) return null;
        return [...ui.navigation.children].find(
          (node) => node.value === 'reading-companion-settings-pane',
        );
      }, 'Native settings sidebar');
      const box = target.getBoundingClientRect();
      for (const type of ['mousedown', 'mouseup'])
        native.windowUtils.sendMouseEvent(
          type,
          box.x + box.width / 2,
          box.y + box.height / 2,
          0,
          1,
          0,
        );
      await until(
        () => {
          const pane = native.document.querySelector('.rc-settings');
          return pane?.getClientRects().length && pane.querySelector('.rc-provider-row');
        },
        'Scholia settings from native sidebar',
        8000,
      );
      assert(
        native.Zotero_Preferences.navigation.value === 'reading-companion-settings-pane',
        'Sidebar click selects and renders Scholia',
      );
    } finally {
      native.close();
    }
    await until(
      () => ![...Services.wm.getEnumerator('zotero:pref')].includes(native),
      'Settings window removed',
    );
    await Zotero.Promise.delay(500);
    panel.root.querySelector('[aria-label="更多"]').click();
    const settingsAction = [...panel.more.querySelectorAll('button')].find(
      (node) => node.textContent === '模型设置',
    );
    assert(settingsAction?.getClientRects().length, 'Settings entry visible in reader menu');
    settingsAction.click();
    const prefs = await until(
      () =>
        [...Services.wm.getEnumerator('zotero:pref')].find(
          (win) =>
            win !== native &&
            !win.closed &&
            win.document.querySelector('.rc-settings .rc-provider-row'),
        ),
      'Settings',
    );
    try {
      const pane = prefs.document.querySelector('.rc-settings');
      const button = (label) =>
        [...pane.querySelectorAll('button')].find(
          (node) => node.textContent === label && node.getClientRects().length,
        );
      assert(
        button('Gemini（API Key）') && button('OpenAI（GPT API）'),
        'Presets visible in Settings',
      );
      const remove = (id) => pane.querySelector(`[data-remove-provider="${id}"]`).click();
      await checkCodexAccount({ Zotero, app, button, remove, until, assert });
      await checkGoogleAccount({ window, prefs, app, Zotero, button, remove, assert, until });
      const count = app.store.configuration().providers.length;
      button('OpenAI（GPT API）').click();
      await Zotero.Promise.delay(300);
      const filename = 'api-settings.png';
      report.screenshots.push({
        name: 'Scholia API settings',
        filename,
        ...(await saveWindow(
          environment,
          prefs,
          PathUtils.join(launcher.runDirectory, 'screenshots', filename),
        )),
      });
      assert(app.store.configuration().providers.length === count, 'Open existing connection');
      remove('openai');
      button('取消').click();
      assert(app.store.configuration().providers.length === count, 'Cancel retains connection');
      await app.secrets.set('openai@https://fixture.invalid', 'old-host-fixture');
      remove('openai');
      button('确认删除').click();
      assert(!pane.querySelector('[data-provider="openai"]'), 'Deleted row disappears');
      assert(!panel.modelMenu.selected, 'Deleted model selection cleared');
      assert(
        !(await app.secrets.get('openai')) &&
          !(await app.secrets.get('openai@https://fixture.invalid')),
        'All keys for connection removed',
      );
      assert(await app.secrets.get('gemini'), 'Other API connection retains its own key');
      button('新增服务商').click();
      const added = pane.querySelector('[aria-expanded="true"][data-provider]').dataset.provider;
      remove(added);
      button('确认删除').click();
      assert(
        !app.store.configuration().providers.some((entry) => entry.id === added),
        'Newly inserted connection can be deleted immediately',
      );
      assert(
        pane.querySelector('[data-provider="gemini"]').getAttribute('aria-expanded') === 'false',
        'Collapsed Gemini row has a direct delete button',
      );
      remove('gemini');
      button('确认删除').click();
      assert(
        Object.values(app.store.configuration().routes).every((id) => id === 'deepseek'),
        'Deleted default is removed from all routes',
      );
      pane.querySelector('[data-provider="deepseek"]').click();
      remove('deepseek');
      button('确认删除').click();
      assert(!app.store.configuration().providers.length, 'Last provider can be removed');
      button('Gemini（API Key）').click();
      assert(
        Object.values(app.store.configuration().routes).every((id) => id === 'gemini'),
        'First connection after empty state restores routes',
      );
      assert(
        panel.session.turns.some((turn) => turn.provider.id === 'openai'),
        'Historical conversation retained',
      );
    } finally {
      prefs.close();
    }
  } finally {
    release?.();
    window.fetch = originalFetch;
  }
}

// The provider's browser consent page and HTTPS services are fixtures. The loopback HTTP
// listener, PKCE verification, settings buttons and Zotero's login storage are exercised.
async function checkGoogleAccount({ window, prefs, app, Zotero, button, remove, assert, until }) {
  const launch = Zotero.launchURL;
  const mainFetch = window.fetch;
  const prefsFetch = prefs.fetch;
  const google = app.models.google;
  const releaseClient = google.releaseClient;
  const packaged = google.releaseClient();
  let challenge,
    refreshes = 0,
    authorized = false;
  const fixture = {
    id: 'fixture.apps.googleusercontent.com',
    secret: 'fixture-client',
    project: 'scholia-fixture',
  };
  Zotero.launchURL = (url) => {
    const auth = new URL(url);
    assert(
      auth.origin === 'https://accounts.google.com' &&
        auth.searchParams.get('code_challenge_method') === 'S256' &&
        auth.searchParams.get('prompt').includes('select_account') &&
        auth.searchParams.get('client_id') === fixture.id,
      'Google system-browser authorization',
    );
    challenge = auth.searchParams.get('code_challenge');
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', 'wrong-state');
    callback.searchParams.set('code', 'fixture-code');
    return (async () => {
      const wrong = await mainFetch(callback.href);
      assert(wrong.status === 400, 'OAuth callback rejects mismatched state');
      callback.searchParams.set('state', auth.searchParams.get('state'));
      const right = await mainFetch(callback.href);
      assert(right.ok, 'Matching Google callback accepted');
    })();
  };
  const fetch = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new window.URLSearchParams(options.body);
      if (params.get('grant_type') === 'authorization_code') {
        const bytes = await window.crypto.subtle.digest(
          'SHA-256',
          new window.TextEncoder().encode(params.get('code_verifier')),
        );
        const hash = window
          .btoa(String.fromCharCode(...new Uint8Array(bytes)))
          .replace(/=/gu, '')
          .replace(/\+/gu, '-')
          .replace(/\//gu, '_');
        assert(
          hash === challenge && params.get('code') === 'fixture-code',
          'PKCE exchange matches',
        );
      } else {
        assert(
          params.get('refresh_token') === 'fixture-refresh',
          'Refresh token retrieved securely',
        );
        refreshes++;
      }
      return new window.Response(
        JSON.stringify({
          access_token: 'fixture-account',
          refresh_token: 'fixture-refresh',
          expires_in: 3600,
        }),
      );
    }
    if (options?.headers?.Authorization === 'Bearer fixture-account') {
      assert(
        new URL(url).hostname === 'generativelanguage.googleapis.com' &&
          options.headers['x-goog-user-project'] === 'scholia-fixture',
        'Google API quota project',
      );
      if (url.endsWith('/models'))
        return new window.Response(JSON.stringify({ data: [{ id: 'gemini-3.8-flash' }] }));
      const request = JSON.parse(options.body);
      const content = request.messages.at(-1).content;
      const payload = JSON.parse(typeof content === 'string' ? content : content[0].text);
      assert(
        payload.evidence && request.model === 'gemini-3.8-flash',
        'Selected PDF evidence sent',
      );
      authorized = true;
      const data = {
        choices: [{ delta: { content: '{"answer":"账号分析结果"}' }, finish_reason: 'stop' }],
      };
      return new window.Response('data: ' + JSON.stringify(data) + '\n\n');
    }
    return mainFetch(url, options);
  };
  try {
    prefs.fetch = window.fetch = fetch;
    if (!packaged) {
      button('Gemini · 用 Google 登录').click();
      await until(
        () =>
          prefs.document
            .querySelector('.rc-settings [role="status"]')
            ?.textContent.includes('此版本尚未开通'),
        'Unconfigured build explains sign-in',
      );
      assert(
        !challenge &&
          !app.store.configuration().providers.some((entry) => entry.type === 'google-oauth'),
        'No file dialog, browser request or empty account record',
      );
    }
    if (packaged?.id !== fixture.id) google.releaseClient = () => fixture;
    button('Gemini · 用 Google 登录').click();
    await until(async () => await google.connected('gemini-account'), 'Google OAuth stored', 7000);
    await until(
      () => !button('Gemini · 用 Google 登录')?.disabled,
      'Google sign-in completed',
      7000,
    );
    const provider = app.store
      .configuration()
      .providers.find((entry) => entry.id === 'gemini-account');
    google.forget(provider.id);
    const panel = app.workspaces.get(window).panel;
    const menu = panel.modelMenu;
    menu.button.click();
    menu.search.value = 'Google 账号';
    menu.search.dispatchEvent(new window.Event('input'));
    const option = await until(() => menu.list.querySelector('button'), 'OAuth model selectable');
    option.click();
    assert(menu.selected.providerId === provider.id, 'Account selected alongside API-key models');
    panel.input.value = '使用 Google 账号分析本页';
    panel.input.dispatchEvent(new window.Event('input'));
    await panel.submit();
    const turn = panel.session.turns.at(-1);
    assert(
      turn.provider.id === provider.id &&
        turn.answer?.text === '账号分析结果' &&
        authorized &&
        refreshes >= 1,
      'PDF question answered via refreshed account token',
    );
    assert(await app.secrets.get('gemini'), 'API key coexists with Google account');
    remove(provider.id);
    button('确认删除').click();
    assert(
      !(await google.connected(provider.id)) && (await app.secrets.get('gemini')),
      'Deleting account connection preserves API key',
    );
  } finally {
    google.releaseClient = releaseClient;
    Zotero.launchURL = launch;
    prefs.fetch = prefsFetch;
    window.fetch = mainFetch;
  }
}

async function checkCodexAccount({ Zotero, app, button, remove, until, assert }) {
  const { models } = app;
  const executable = models.executable;
  const connect = models.connectCodex;
  const launch = Zotero.launchURL;
  const routes = JSON.stringify(app.store.configuration().routes);
  let completed, opened;
  try {
    models.executable = async () => 'isolated-codex-fixture';
    models.connectCodex = async () => ({
      close: async () => {},
      client: {
        notify: async () => {},
        onNotification: (listener) => {
          completed = listener;
          return () => {};
        },
        request: async (method, params) => {
          if (method === 'account/login/start') {
            assert(params.type === 'chatgpt', 'Codex uses ChatGPT account sign-in');
            return { loginId: 'mock', authUrl: 'https://auth.openai.com/authorize' };
          }
          if (method === 'account/read') return { account: { type: 'chatgpt' } };
          if (method === 'model/list') return { data: [] };
          return {};
        },
      },
    });
    Zotero.launchURL = (url) => {
      opened = url;
      completed('account/login/completed', { loginId: 'mock', success: true });
    };
    button('Codex · 用 ChatGPT 登录').click();
    await until(() => !button('Codex · 用 ChatGPT 登录').disabled, 'Codex settings sign-in');
    assert(opened === 'https://auth.openai.com/authorize', 'One click opens official Codex login');
    const provider = app.store.configuration().providers.find((entry) => entry.type === 'codex');
    assert(provider?.name === 'Codex（ChatGPT 账号）', 'Codex provider has explicit account label');
    assert(JSON.stringify(app.store.configuration().routes) === routes, 'Other routes preserved');
    remove(provider.id);
    button('确认删除').click();
  } finally {
    models.executable = executable;
    models.connectCodex = connect;
    Zotero.launchURL = launch;
  }
}
