import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { ReadingPanel } from '../src/ui/panel.js';
import { ReaderWorkspace } from '../src/runtime/workspace.js';
import { defaultConfiguration } from '../src/domain/configuration.js';
import { redactDiagnostic } from '../src/domain/diagnostics.js';
import { validateTranslation } from '../src/domain/translation.js';
import { renderRichText } from '../src/ui/rich-text.js';
import { ReadingSession } from '../src/application/reading-session.js';
import { captureEvidence } from '../src/domain/evidence.js';
import { providerSignature } from '../src/domain/configuration.js';
import { view, memoryStore, specification } from './helpers.js';

test('偏好脚本先于 DOM 加载，收到面板 load 后恰好挂载一次', async () => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  let mounted = 0;
  dom.window.Zotero = { 'reading-companion@local': { mountSettings: () => mounted++ } };
  vm.runInContext(await readFile('addon/preferences.js', 'utf8'), dom.getInternalVMContext());
  assert.equal(mounted, 0);
  const root = dom.window.document.createElement('div');
  root.id = 'reading-companion-settings';
  dom.window.document.body.append(root);
  root.dispatchEvent(new dom.window.Event('load'));
  root.dispatchEvent(new dom.window.Event('load'));
  assert.equal(mounted, 1);
  dom.window.close();
});

test('全高阅读面板可恢复原生上下文，销毁清理订阅和 DOM', () => {
  const dom = new JSDOM(
    '<div id="zotero-context-pane"><div id="native"></div>' + '<nav hidden></nav></div>',
  );
  const window = dom.window;
  window.ZoteroContextPane = { collapsed: true };
  let subscribed = 0;
  const application = {
    panels: new Map(),
    recordFailure: () => {},
    reader: {
      active: () => null,
      current: () => {
        throw new Error('No reader');
      },
    },
    sessions: {
      subscribe: () => {
        subscribed++;
        return () => subscribed--;
      },
      running: new Map(),
    },
    store: { configuration: () => defaultConfiguration },
  };
  const workspace = new ReaderWorkspace(window, application);
  assert.equal(window.ZoteroContextPane.collapsed, false);
  assert.equal(window.document.getElementById('native').hidden, true);
  workspace.hide();
  assert.equal(window.document.getElementById('native').hidden, false);
  assert.equal(window.document.querySelector('nav').hidden, true);
  workspace.show();
  workspace.destroy();
  assert.equal(application.panels.size, 0);
  assert.equal(subscribed, 0);
  assert.equal(window.document.querySelector('.rc-workspace'), null);
  assert.equal(window.document.getElementById('native').hidden, false);
  window.close();
});

test('日志遮盖凭据；信号位宽和流式 Markdown 可沿用安全富文本渲染', () => {
  const redacted = redactDiagnostic('Authorization: Bearer secret-token api_key=secret-key');
  assert.doesNotMatch(redacted, /secret-token|secret-key/u);
  assert.doesNotMatch(
    redactDiagnostic(
      'https://localhost/callback?code=private-code&state=private-state ' +
        'refresh_token=private-refresh',
    ),
    /private-/u,
  );
  const dom = new JSDOM('');
  const content = renderRichText(dom.window.document, '**保持** DATA[7:0] 与 VALID=1。');
  assert.equal(content.querySelector('strong').textContent, '保持');
  assert.equal(content.querySelector('code').textContent, 'DATA[7:0]');
  assert.doesNotMatch(content.textContent, /\*\*/u);
  dom.window.close();
});

test('真实脚注混用 shall 和 may，不把另一句的必须误报为 may 加强', () => {
  const original = 'Writing 1 shall clear DONE. Hardware may set DONE in the same cycle.';
  const result = validateTranslation(
    [{ id: 'a', text: original }],
    [
      {
        id: 'a',
        original,
        translation: '写入 1 时必须清除 DONE。硬件可以在同一周期置位 DONE。',
      },
    ],
  );
  assert.equal(result.state, 'complete');
});

test('主题重绘期间没有画布时，视觉问答明确重试，不悄悄只发文字', async () => {
  const captured = view();
  captured.images = [];
  const provider = structuredClone(defaultConfiguration.providers[0]);
  provider.probe = { signature: providerSignature(provider), text: true, vision: true };
  let called = false;
  const states = [];
  const session = new ReadingSession({
    reader: { capture: () => captureEvidence(captured, 'id'), pages: async () => specification },
    store: memoryStore(),
    models: {
      run: async () => {
        called = true;
      },
    },
    identifier: () => 'id',
    createAbortController: () => new AbortController(),
  });
  session.subscribe((_id, state) => states.push(state));
  await session.send({ question: '那现在这张图呢', purpose: 'ask', provider });
  assert.equal(called, false);
  assert.ok(states.some((state) => state.error?.code === 'reader-image'));
});

test('主动发送的新回合滚入视野；之后向上阅读时流式更新不抢滚动', () => {
  const dom = new JSDOM('<main></main>');
  const application = {
    reader: {
      active: () => null,
      current: () => {
        throw new Error('No reader');
      },
    },
    sessions: { subscribe: () => () => {}, running: new Map() },
    store: { configuration: () => defaultConfiguration },
  };
  const panel = new ReadingPanel(
    dom.window.document,
    dom.window.document.querySelector('main'),
    application,
  );
  Object.defineProperty(panel.conversation, 'scrollHeight', { get: () => 500 });
  Object.defineProperty(panel.conversation, 'clientHeight', { get: () => 200 });
  panel.conversation.scrollTop = 20;
  const turn = {
    id: 'new',
    state: 'streaming',
    question: '为什么',
    purpose: 'ask',
    provider: { name: 'Codex' },
    snapshot: captureEvidence(view(), 'snapshot'),
    scope: '本页',
    preview: '',
  };
  panel.displayTurn(turn);
  assert.equal(panel.conversation.scrollTop, 500);
  panel.conversation.scrollTop = 20;
  turn.preview = '正在解释';
  panel.displayTurn(turn);
  assert.equal(panel.conversation.scrollTop, 20);
  panel.destroy();
  dom.window.close();
});
