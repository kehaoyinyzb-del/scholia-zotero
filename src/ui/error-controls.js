import { element, action } from './dom.js';

export function errorControls(document, application, feedback, provider, callbacks = {}) {
  const controls = element(document, 'div', null, { class: 'rc-turn-actions rc-error-actions' });
  if (['login', 'codex-old', 'executable'].includes(feedback.code))
    controls.append(
      action(document, feedback.code === 'login' ? '重新登录' : '连接账号', () =>
        application.openConnection(callbacks.loggedIn),
      ),
    );
  if (callbacks.retry) controls.append(action(document, '重试这次提问', callbacks.retry));
  controls.append(
    action(document, '复制诊断信息', () => application.copyDiagnostics(feedback, provider)),
  );
  return controls;
}
