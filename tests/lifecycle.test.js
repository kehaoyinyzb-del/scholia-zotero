import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/runtime/application.js';
import { extractPage } from '../src/domain/pdf-layout.js';

test('重复启停注销所有官方入口，HTTP 配对码只存登录管理器', async () => {
  const preferences = new Map();
  const logins = [];
  const sections = new Set();
  const listeners = new Set();
  const panes = new Set();
  const environment = {
    Zotero: {
      DataDirectory: { dir: '/isolated' },
      File: { getContentsFromURL: (url) => (url.endsWith('.json') ? '{"entries":[]}' : '') },
      Notifier: { registerObserver: () => 1, unregisterObserver: () => {} },
      Prefs: {
        get: (key) => preferences.get(key),
        set: (key, value) => preferences.set(key, value),
      },
      getMainWindows: () => [],
      Server: { Endpoints: {}, port: 23129 },
      ItemPaneManager: {
        registerSection: (section) => {
          sections.add(section.paneID);
          return section.paneID;
        },
        unregisterSection: (identifier) => sections.delete(identifier),
      },
      MenuManager: {
        registerMenu: ({ menuID }) => {
          panes.add(menuID);
          return menuID;
        },
        unregisterMenu: (menuID) => panes.delete(menuID),
      },
      PreferencePanes: {
        register: async (pane) => panes.add(pane.id),
        unregister: (identifier) => panes.delete(identifier),
      },
      Reader: {
        registerEventListener: (_type, listener) => listeners.add(listener),
        unregisterEventListener: (_type, listener) => listeners.delete(listener),
      },
    },
    Services: {
      uuid: { generateUUID: () => '{synthetic-pairing-secret}' },
      logins: {
        findLogins: (_origin, _form, realm) => logins.filter((login) => login.realm === realm),
        addLoginAsync: async (login) => logins.push(login),
      },
    },
    Components: {
      classes: {
        '@mozilla.org/login-manager/loginInfo;1': {
          createInstance: () => ({
            init(_origin, _form, realm, _user, password) {
              Object.assign(this, { realm, password });
            },
          }),
        },
      },
      interfaces: { nsILoginInfo: {} },
    },
    IOUtils: {
      makeDirectory: async () => {},
      readJSON: async () => {
        throw Object.assign(new Error(), { name: 'NotFoundError' });
      },
      writeUTF8: async () => {},
    },
    PathUtils: { join: (...pieces) => pieces.join('/') },
  };
  for (let cycle = 0; cycle < 2; cycle++) {
    const application = createApplication(
      environment,
      'file:///plugin/',
      'reading-companion@local',
    );
    await application.start();
    assert.equal(Object.keys(environment.Zotero.Server.Endpoints).length, 6);
    const PairingEndpoint = environment.Zotero.Server.Endpoints['/reading-companion/pair'];
    const request = {
      headers: {
        origin: 'chrome-extension://test-client',
        'x-reading-companion-client': 'chrome-extension://test-client',
        'x-reading-companion-token': logins[0].password,
      },
      data: {},
    };
    assert.equal((await new PairingEndpoint().init(request))[0], 200);
    request.headers.origin = 'https://malicious.example';
    assert.equal((await new PairingEndpoint().init(request))[0], 403);
    assert.doesNotMatch(JSON.stringify([...preferences]), /synthetic-pairing-secret/u);
    await application.stop();
    assert.equal(Object.keys(environment.Zotero.Server.Endpoints).length, 0);
    assert.equal(sections.size + panes.size + listeners.size, 0);
  }
});

test('PDF 表格行保留列分隔与可高亮坐标，无文本层有明确标记', () => {
  const content = ['Name', 'Bits', 'Access'].map((text, index) => ({
    str: text,
    width: 30,
    height: 10,
    transform: [1, 0, 0, 1, 20 + index * 100, 200],
  }));
  const page = extractPage(content, 0, 600, 'i');
  assert.equal(page.paragraphs[0].text, 'Name | Bits | Access');
  assert.equal(page.paragraphs[0].position.rects.length, 3);
  assert.equal(page.printedPage, 'i');
  assert.equal(extractPage([], 1, 600).noText, true);
});
