import { element, action, labeledControl } from './dom.js';
import { icon } from './icons.js';
import { apiPresets } from '../runtime/setup.js';
import { ReadingError, errorFeedback } from '../domain/errors.js';
import { codexVersion } from '../domain/codex-release.js';

export class Onboarding {
  constructor(panel) {
    this.panel = panel;
    this.application = panel.application;
    this.document = panel.document;
    this.root = element(this.document, 'section', null, { class: 'rc-onboarding', hidden: '' });
    this.root.append(
      element(this.document, 'h3', '开始使用 Scholia'),
      element(
        this.document,
        'p',
        '连接自己的 ChatGPT、Google 账号或 API 密钥，就可以对着这篇文献提问、翻译和总结。',
      ),
    );
    this.login = action(this.document, 'Codex · 用 ChatGPT 登录', () => this.signIn(), {
      class: 'rc-primary',
    });
    this.root.append(this.login);
    const plan = element(
      this.document,
      'small',
      '使用你的 ChatGPT 套餐额度，不另外收费；部分套餐可能无法使用，以 OpenAI 的说明为准。',
      { class: 'rc-onboarding-note' },
    );
    plan.append(
      action(this.document, '查看说明', () =>
        this.openURL('https://learn.chatgpt.com/docs/pricing'),
      ),
    );
    this.root.append(
      plan,
      action(this.document, 'Gemini · 用 Google 登录', () => this.signInGoogle(), {
        class: 'rc-button',
      }),
      element(this.document, 'small', '在浏览器选择 Google 账号，授权后回到 Zotero。', {
        class: 'rc-onboarding-note',
      }),
    );
    this.status = element(this.document, 'p', '', { role: 'status', 'aria-live': 'polite' });
    this.controls = element(this.document, 'div', null, { class: 'rc-turn-actions' });
    this.root.append(this.status, this.controls);
    const api = element(this.document, 'details');
    const apiHeading = element(this.document, 'summary', '使用 API 密钥');
    apiHeading.prepend(icon(this.document, 'down'));
    api.append(apiHeading);
    this.preset = element(this.document, 'select', null, { 'aria-label': '服务商' });
    // The list is data: whatever presets the runtime ships, plus any compatible endpoint.
    for (const provider of apiPresets)
      this.preset.append(element(this.document, 'option', provider.name, { value: provider.id }));
    this.preset.append(
      element(this.document, 'option', '自定义（OpenAI 兼容）', { value: '__custom__' }),
    );
    this.key = element(this.document, 'input', null, {
      type: 'password',
      autocomplete: 'new-password',
      placeholder: '粘贴密钥，自动测试连接',
      'aria-label': 'API 密钥',
    });
    this.customAddress = element(this.document, 'input', null, {
      type: 'url',
      placeholder: 'https://api.example.com/v1',
    });
    this.customModel = element(this.document, 'input', null, { placeholder: '例如 gpt-4.1-mini' });
    const custom = element(this.document, 'div', null, { hidden: '' });
    custom.append(labeledControl(this.document, '接口地址', this.customAddress));
    this.customModel.placeholder = apiPresets[0].model;
    this.key.addEventListener('input', () => this.scheduleProbe());
    this.preset.addEventListener('change', () => {
      this.key.value = '';
      this.clearFeedback();
      custom.hidden = this.preset.value !== '__custom__';
      this.customModel.value = '';
      this.customModel.placeholder =
        apiPresets.find((entry) => entry.id === this.preset.value)?.model || '输入模型 ID';
      this.scheduleProbe();
    });
    for (const field of [this.customAddress, this.customModel])
      field.addEventListener('change', () => this.scheduleProbe());
    this.apiStatus = element(this.document, 'div', null, { role: 'status', 'aria-live': 'polite' });
    this.apiNotice = element(this.document, 'small', '', {
      hidden: '',
      class: 'rc-onboarding-note',
    });
    const keyRow = element(this.document, 'div', null, { class: 'rc-api-key' });
    keyRow.append(
      this.key,
      action(this.document, '测试', () => this.testAPI(), {
        class: 'rc-button',
        'aria-label': '重新检测密钥',
        title: '用自制短句测试连接，不发送文献内容',
      }),
    );
    const keyField = element(this.document, 'label', null, { class: 'rc-field' });
    keyField.append(element(this.document, 'span', 'API 密钥'), keyRow);
    api.append(
      labeledControl(this.document, '服务商', this.preset),
      custom,
      labeledControl(this.document, '模型 ID', this.customModel),
      keyField,
      this.apiStatus,
      this.apiNotice,
    );
    this.root.append(api);
    const options = element(this.document, 'details');
    const advanced = element(this.document, 'summary', '找不到 Codex 或需要代理');
    advanced.prepend(icon(this.document, 'down'));
    options.append(advanced);
    options.append(
      action(this.document, '我已安装，重新检测', () => this.check()),
      action(this.document, '手动选择 Codex 位置', () => this.selectFile()),
      action(this.document, `安装 / 更新到 Codex ${codexVersion}`, () => this.update()),
      action(this.document, '官方下载页', () =>
        this.openURL('https://github.com/openai/codex/releases'),
      ),
    );
    this.proxy = element(this.document, 'input', null, {
      placeholder: '例如 http://127.0.0.1:7890',
      type: 'url',
    });
    this.proxy.value =
      this.application.environment.Zotero.Prefs.get(
        'extensions.readingCompanion.codexProxy',
        true,
      ) || '';
    options.append(
      labeledControl(this.document, 'Codex 代理（留空继承环境）', this.proxy),
      action(this.document, '保存代理', () => this.saveProxy()),
    );

    this.cancel = action(this.document, '取消', () => this.controller?.abort(), { hidden: '' });
    this.reopen = action(
      this.document,
      '重新打开',
      () => {
        if (this.loginURL) this.openURL(this.loginURL);
      },
      { hidden: '' },
    );
    this.controls.append(this.reopen, this.cancel);
    this.root.append(options);
    panel.conversation.before(this.root);
  }

  openURL(url) {
    this.application.environment.Zotero.launchURL(url);
  }

  show(onComplete) {
    this.onComplete = onComplete;
    this.root.hidden = false;
    this.panel.root.classList.add('rc-setup-active');
  }

  async check() {
    try {
      await this.application.setup.available();
      await this.complete();
    } catch (error) {
      if (this.root.hidden) this.show();
      if (['executable', 'login'].includes(error.code)) this.clearFeedback();
      else this.failure(error);
    }
  }

  clearFeedback() {
    this.status.textContent = '';
    this.apiStatus.replaceChildren();
    for (const button of this.root.querySelectorAll('[data-diagnostics]')) button.remove();
  }

  failure(error, provider) {
    const feedback = errorFeedback(error, provider?.type || 'codex');
    if (feedback.code === 'cancelled') {
      this.clearFeedback();
      return;
    }
    const target = provider && provider.type !== 'google-oauth' ? this.apiStatus : this.status;
    const messages = {
      key: '密钥不正确，请检查后重新粘贴。',
      balance: '账户余额不足，请充值后重试。',
      rate: '请求过于频繁，请稍后重试。',
      quota: '账户额度已用尽，请等待恢复或更换服务商。',
      connection: '服务地址连不上，请检查网络或代理。',
      model: '当前模型不可用，请检查服务商与模型设置。',
    };
    target.textContent =
      provider && messages[feedback.code]
        ? messages[feedback.code]
        : `${feedback.title}。${feedback.reason}${feedback.action}`;
    target.append(
      action(
        this.document,
        '复制诊断信息',
        () =>
          this.application.copyDiagnostics(feedback, provider || this.application.setup.provider()),
        { 'data-diagnostics': '' },
      ),
    );
  }

  async perform(operation, provider) {
    this.controller?.abort();
    const controller = new this.document.defaultView.AbortController();
    this.controller = controller;
    this.application.setup.controllers.add(controller);
    this.clearFeedback();
    this.cancel.hidden = false;
    this.login.disabled = true;
    const pending = operation(controller.signal);
    this.application.setup.pending.add(pending);
    try {
      await pending;
    } catch (error) {
      if (this.controller === controller) this.failure(error, provider);
    } finally {
      this.application.setup.pending.delete(pending);
      this.application.setup.controllers.delete(controller);
      if (this.controller === controller) {
        this.loginURL = null;
        this.reopen.hidden = true;
        this.cancel.hidden = true;
        this.login.disabled = false;
      }
    }
  }

  signInGoogle() {
    const app = this.application;
    const provider = app.setup.googleProvider();
    return this.perform(async (signal) => {
      await app.models.google.login(this.document.defaultView, provider, signal, (message) => {
        this.status.textContent = message;
      });
      signal.throwIfAborted();
      app.setup.save(provider);
      await this.complete(true);
    }, provider);
  }

  signIn() {
    return this.perform(async (signal) => {
      await this.application.setup.login(this.document.defaultView, {
        signal,
        onLoginURL: (url) => {
          this.loginURL = url;
          this.reopen.hidden = false;
        },
        onProgress: (text) => {
          this.status.textContent = text;
        },
      });
      await this.complete(true);
    });
  }

  scheduleProbe() {
    clearTimeout(this.probeTimer);
    this.controller?.abort();
    if (this.key.value.trim()) this.probeTimer = setTimeout(() => this.testAPI(), 700);
  }

  customProvider() {
    const address = this.customAddress.value.trim();
    const model = this.customModel.value.trim();
    if (!address || !model) return null;
    return {
      id: 'custom-' + this.application.identifier().slice(0, 8),
      name: new URL(address).hostname,
      type: 'openai',
      baseURL: address,
      model,
      context: 32000,
      vision: false,
    };
  }

  testAPI() {
    let provider;
    try {
      provider =
        this.preset.value === '__custom__'
          ? this.customProvider()
          : apiPresets.find((entry) => entry.id === this.preset.value);
      if (provider && this.customModel.value.trim())
        provider = { ...provider, model: this.customModel.value.trim() };
    } catch {
      this.apiStatus.textContent = '接口地址格式不对，应以 https:// 开头。';
      return;
    }
    if (!provider) {
      this.apiStatus.textContent = '请先填写接口地址和模型 ID。';
      return;
    }
    const key = this.key.value.trim();
    if (!key) return;
    return this.perform(async (signal) => {
      this.apiStatus.textContent = '正在测试连接…';
      const result = await this.application.setup.testAPI(provider, key, signal);
      signal.throwIfAborted();
      this.key.value = '';
      this.apiNotice.hidden = result.probe.vision;
      this.apiNotice.textContent = '这个模型看不到图，读图类问题会受限。';
      await this.complete(true);
      this.panel.flash(
        result.probe.vision ? '已连接，可以读图。' : '这个模型看不到图，读图类问题会受限。',
      );
    }, provider);
  }

  async complete(resetSelection = false) {
    const app = this.application;
    const config = app.store.configuration();
    const provider = config.providers.find((entry) => entry.id === config.routes.ask);
    if (!provider) return this.show();
    const catalog = await app.models.catalog(provider);
    app.environment.Zotero.Prefs.set('extensions.readingCompanion.onboardingComplete', true, true);
    this.root.hidden = true;
    this.panel.root.classList.remove('rc-setup-active');
    if (resetSelection) this.panel.modelMenu.selected = null;
    this.panel.modelMenu.defaultModel = catalog.models.find((model) => model.isDefault);
    this.panel.refreshModels();
    const callback = this.onComplete;
    this.onComplete = null;
    callback?.();
  }

  selectFile() {
    return this.perform(async () => {
      if (await this.application.setup.selectFile(this.document.defaultView)) await this.check();
    });
  }

  update() {
    return this.perform(async (signal) => {
      const path = await this.application.models.runtime.install(
        this.document.defaultView,
        (text) => {
          this.status.textContent = text;
        },
        signal,
      );
      this.application.setup.save({ ...this.application.setup.provider(), path }, false);
      this.status.textContent = 'Codex 已准备好，可以点击登录。';
    });
  }

  saveProxy() {
    try {
      const value = this.proxy.value.trim();
      if (value) {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('代理地址须为 HTTP(S)，且不含用户名和密码。');
      }
      this.application.environment.Zotero.Prefs.set(
        'extensions.readingCompanion.codexProxy',
        value,
        true,
      );
      this.status.textContent = '已保存，后续 Codex 连接会使用此设置。';
    } catch {
      this.failure(new ReadingError('proxy'));
    }
  }

  destroy() {
    clearTimeout(this.probeTimer);
    this.controller?.abort();
    this.root.remove();
  }
}
