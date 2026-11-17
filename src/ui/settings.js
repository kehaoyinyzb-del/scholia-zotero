import { errorControls } from './error-controls.js';
import { icon, labeledAction } from './icons.js';
import { apiKeyId, modelCapabilities, providerSignature } from '../domain/configuration.js';
import { element, action, labeledControl } from './dom.js';
import { clone } from '../domain/immutable.js';
import { errorFeedback } from '../domain/errors.js';
import { apiPresets, googleAccount } from '../runtime/setup.js';
import { effortNames, modelLabel } from './model-menu.js';

const chatPreference = 'extensions.readingCompanion.chatModel.v1';

/** Which preset (or local Codex, or a custom endpoint) a stored provider corresponds to. */
function providerKind(provider) {
  if (provider.type === 'google-oauth') return googleAccount.id;
  if (provider.type === 'codex') return 'codex';
  const base = (provider.baseURL || '').replace(/\/$/u, '');
  const preset = apiPresets.find((entry) => entry.baseURL.replace(/\/$/u, '') === base);
  return preset ? preset.id : 'custom';
}

export function mountSettings(document, application) {
  const root = document.getElementById('reading-companion-settings');
  if (!root || root.childElementCount) return;
  root.className = 'rc-settings';
  root.setAttribute('lang', 'zh-CN');
  const preferences = application.environment.Zotero.Prefs;
  let configuration = application.store.configuration();
  let testing;
  let authorizing;
  let accountPending;
  let savingKey;
  let keyTimer;
  const deletion = element(document, 'div', null, { hidden: '', class: 'rc-actions' });
  const picker = element(document, 'select');
  const providerList = element(document, 'div', null, { class: 'rc-provider-list' });
  const editor = element(document, 'div', null, { class: 'rc-provider-editor', hidden: '' });
  const name = element(document, 'input');
  // Service choices are data: local Codex, every runtime preset, then any compatible API.
  const kind = element(document, 'select');
  kind.append(element(document, 'option', 'Codex（ChatGPT 账号）', { value: 'codex' }));
  for (const preset of apiPresets)
    kind.append(element(document, 'option', preset.name, { value: preset.id }));
  kind.append(element(document, 'option', '自定义（OpenAI 兼容）', { value: 'custom' }));
  const accountKind = element(document, 'option', googleAccount.name, { value: googleAccount.id });
  kind.append(accountKind);
  const model = element(document, 'select');
  const customModel = element(document, 'input', null, { placeholder: '输入模型 ID' });
  const modelReason = element(document, 'small', '', { class: 'rc-muted' });
  const address = element(document, 'input', null, { type: 'url', placeholder: 'https://…' });
  const path = element(document, 'input', null, { placeholder: '留空自动发现 Codex' });
  const context = element(document, 'input', null, { type: 'number', min: '4096' });
  const timeout = element(document, 'input', null, { type: 'number', min: '10', max: '600' });
  timeout.value = configuration.timeout / 1000;
  const secret = element(document, 'input', null, {
    type: 'password',
    autocomplete: 'new-password',
    placeholder: '已保存的密钥不会显示',
    'aria-label': 'API 密钥',
  });
  const status = element(document, 'p', '', { role: 'status', 'aria-live': 'polite' });
  let feedbackTimer;
  const success = (message) => {
    status.textContent = message;
    document.defaultView.clearTimeout(feedbackTimer);
    feedbackTimer = document.defaultView.setTimeout(() => {
      if (status.textContent === message) status.textContent = '';
    }, 2500);
  };
  const routes = {};
  const shared = element(document, 'select');
  const syncShared = () => {
    const values = Object.values(routes).map((route) => route.value);
    shared.value = values.every((value) => value === values[0]) ? values[0] : '';
  };
  const typeOf = () =>
    kind.value === 'codex'
      ? 'codex'
      : kind.value === googleAccount.id
        ? 'google-oauth'
        : apiPresets.find((preset) => preset.id === kind.value)?.type || 'openai';
  const addressField = labeledControl(document, '接口地址', address);
  const pathField = labeledControl(document, 'Codex 可执行文件', path);
  const keyRow = element(document, 'div', null, { class: 'rc-key-row' });
  const keyField = element(document, 'div', null, { class: 'rc-field' });
  keyField.append(element(document, 'span', 'API 密钥'), keyRow);
  const advancedAddress = element(document, 'div');
  // Assigned once below; the field toggler runs before it exists.
  // eslint-disable-next-line prefer-const
  let removeKey;
  const googleControls = element(document, 'div', null, { class: 'rc-field', hidden: '' });
  const updateKindFields = () => {
    const local = kind.value === 'codex';
    const account = kind.value === googleAccount.id;
    googleControls.hidden = !account;
    kind.disabled = account;
    accountKind.hidden = !account;
    accountKind.disabled = !account;
    keyField.hidden = local || account;
    if (removeKey) removeKey.hidden = local || account;
    pathField.hidden = !local;
    // A preset's address is fixed data; only a custom endpoint asks for it up front.
    (kind.value === 'custom' ? addressSlot : advancedAddress).append(addressField);
    addressField.hidden = local || account;
  };
  const addressSlot = element(document, 'div');
  let catalogVersion = 0;
  kind.addEventListener('change', () => {
    catalogVersion++;
    catalogModels = [];
    effortField.hidden = true;
    modelReason.textContent = '';
    customModel.hidden = true;
    secret.value = '';
    document.defaultView.clearTimeout(keyTimer);
    const preset = apiPresets.find((entry) => entry.id === kind.value);
    if (preset) {
      address.value = preset.baseURL;
      customModel.value = preset.model;
      model.replaceChildren(
        element(document, 'option', preset.model, { value: preset.model }),
        element(document, 'option', '手动填写…', { value: '__custom__' }),
      );
      model.value = preset.model;
      if (!name.value.trim() || ['新服务商', ...apiPresets.map((p) => p.name)].includes(name.value))
        name.value = preset.name;
      context.value = preset.context;
    } else if (kind.value === 'custom') {
      model.replaceChildren(element(document, 'option', '手动填写…', { value: '__custom__' }));
      customModel.hidden = false;
    }
    updateKindFields();
  });
  for (const purpose of ['ask', 'translate', 'vision', 'selection'])
    routes[purpose] = element(document, 'select');
  const updateChoices = () => {
    const selected = picker.value;
    picker.replaceChildren(
      ...configuration.providers.map((provider) => {
        return element(document, 'option', provider.name, { value: provider.id });
      }),
    );
    picker.value = configuration.providers.some((provider) => provider.id === selected)
      ? selected
      : configuration.providers[0]?.id || '';
    for (const [purpose, select] of Object.entries(routes)) {
      select.replaceChildren(
        ...configuration.providers.map((provider) => {
          return element(document, 'option', provider.name, { value: provider.id });
        }),
      );
      select.value = configuration.routes[purpose] || configuration.routes.translate;
    }
    shared.replaceChildren(
      element(document, 'option', '按用途分别选择', { value: '', disabled: '' }),
      ...configuration.providers.map((provider) =>
        element(document, 'option', provider.name, { value: provider.id }),
      ),
    );
    syncShared();
  };
  // The chat default (model and thinking effort) lives in the same preference the
  // composer's model menu reads, so both places always agree.
  const readChoice = () => {
    try {
      return JSON.parse(preferences.get(chatPreference, true));
    } catch {
      return null;
    }
  };
  const storeChoice = (choice) => {
    preferences.set(chatPreference, JSON.stringify(choice), true);
    for (const panel of application.panels.values()) {
      panel.modelMenu.selected = choice;
      panel.modelMenu.updateLabel();
    }
  };
  const effort = element(document, 'select', null, { 'aria-label': '思考深度' });
  const effortField = labeledControl(document, '思考深度', effort);
  effortField.title = '思考越深，回答越慢、消耗额度越多';
  let catalogModels = [];
  const chatProvider = (provider) => {
    const choice = readChoice();
    return choice ? choice.providerId === provider.id : configuration.routes.ask === provider.id;
  };
  const renderEffort = () => {
    const provider = configuration.providers.find((entry) => entry.id === picker.value);
    const entry = catalogModels.find((item) => item.model === model.value);
    const values = (entry?.supportedReasoningEfforts || []).map((item) => item.reasoningEffort);
    effortField.hidden = values.length < 2;
    effort.replaceChildren(
      ...values.map((value) =>
        element(
          document,
          'option',
          effortNames[value] ? `${effortNames[value]}（${value}）` : value,
          {
            value,
          },
        ),
      ),
    );
    const choice = readChoice();
    effort.value =
      choice?.providerId === provider?.id && choice?.model === model.value && choice.effort
        ? choice.effort
        : entry?.defaultReasoningEffort || values[0] || '';
  };
  const chooseChat = (provider, entry, value) =>
    storeChoice({
      providerId: provider.id,
      model: entry.model,
      name: entry.displayName || entry.model || '默认模型',
      effort: value || entry.defaultReasoningEffort || null,
      tier: value ? null : 'standard',
      inputModalities: entry.inputModalities,
    });
  effort.addEventListener('change', () => {
    const provider = configuration.providers.find((entry) => entry.id === picker.value);
    const entry = catalogModels.find((item) => item.model === model.value);
    if (provider && entry) chooseChat(provider, entry, effort.value);
  });
  const loadProvider = () => {
    document.defaultView.clearTimeout(keyTimer);
    testing?.abort();
    deletion.hidden = true;
    authorizing?.abort();
    const version = ++catalogVersion;
    const provider = configuration.providers.find((entry) => entry.id === picker.value);
    if (!provider) {
      editor.hidden = true;
      return;
    }
    name.value = provider.name;
    accountKind.disabled = provider.type !== 'google-oauth';
    kind.value = providerKind(provider);
    model.replaceChildren(
      element(document, 'option', provider.model || '默认模型', { value: provider.model || '' }),
    );
    model.value = provider.model;
    customModel.value = provider.model;
    customModel.hidden = true;
    modelReason.textContent = '';
    catalogModels = [];
    effortField.hidden = true;
    application.models.catalog(provider).then((catalog) => {
      if (version !== catalogVersion) return;
      const choices = [...catalog.models];
      catalogModels = choices;
      if (!choices.some((entry) => entry.model === provider.model))
        choices.push({ model: provider.model, displayName: provider.model || '默认模型' });
      model.replaceChildren(
        ...choices.map((entry) =>
          element(document, 'option', modelLabel(entry.displayName || entry.model || '默认模型'), {
            value: entry.model,
          }),
        ),
      );
      if (provider.type !== 'codex')
        model.append(element(document, 'option', '手动填写…', { value: '__custom__' }));
      const choice = readChoice();
      model.value =
        provider &&
        choice?.providerId === provider.id &&
        choices.some((entry) => entry.model === choice.model)
          ? choice.model
          : provider.model;
      modelReason.textContent = catalog.reason || '';
      renderEffort();
    });
    address.value = provider.baseURL || '';
    path.value = provider.path || '';
    context.value = provider.context;
    secret.value = '';
    updateKindFields();
  };
  updateChoices();
  loadProvider();
  picker.addEventListener('change', loadProvider);
  model.addEventListener('change', () => {
    customModel.hidden = model.value !== '__custom__';
    const provider = configuration.providers.find((entry) => entry.id === picker.value);
    const entry = catalogModels.find((item) => item.model === model.value);
    if (provider && entry && chatProvider(provider)) chooseChat(provider, entry);
    renderEffort();
  });
  const captureConfiguration = () => {
    const next = clone(configuration);
    const provider = next.providers.find((entry) => entry.id === picker.value);
    if (provider) {
      const oldOrigin = provider.baseURL && new URL(provider.baseURL).origin;
      Object.assign(provider, {
        name: name.value.trim(),
        type: typeOf(),
        model: (model.value === '__custom__' ? customModel.value : model.value).trim(),
        context: Number(context.value),
      });
      if (oldOrigin && (provider.type === 'codex' || oldOrigin !== new URL(address.value).origin))
        provider.legacyKeyOrigin ||= oldOrigin;
      if (provider.type === 'codex') {
        provider.path = path.value.trim();
        delete provider.baseURL;
      } else {
        provider.baseURL = address.value.trim();
        delete provider.path;
      }
    }
    next.translation = {
      ...configuration.translation,
      language: language.value.trim() || '中文',
      trigger: trigger.value,
      annotationComment: annotationComment.checked,
    };
    next.timeout = Math.max(10000, Math.min(600000, Number(timeout.value) * 1000));
    for (const purpose of Object.keys(routes)) next.routes[purpose] = routes[purpose].value;
    application.store.saveConfiguration(next);
    const previous = configuration.providers.find((entry) => entry.id === provider?.id);
    const choice = readChoice();
    if (next.routes.ask !== configuration.routes.ask) storeChoice(null);
    else if (
      provider &&
      choice?.providerId === provider.id &&
      (previous.baseURL !== provider.baseURL ||
        (previous.model !== provider.model && choice.model !== provider.model))
    ) {
      chooseChat(provider, { model: provider.model });
    }
    configuration = next;
    for (const panel of application.panels.values()) panel.refreshModels();
    return provider;
  };
  const guarded = (callback) => async () => {
    try {
      await callback();
    } catch (error) {
      const feedback = errorFeedback(error, typeOf());
      status.replaceChildren(
        document.createTextNode(
          error.code ? feedback.title + '。' + feedback.reason + feedback.action : error.message,
        ),
        errorControls(
          document,
          application,
          feedback,
          configuration.providers.find((entry) => entry.id === picker.value),
        ),
      );
    }
  };
  const cancelTest = action(document, '取消测试', () => testing?.abort(), {
    class: 'rc-link',
    hidden: '',
  });
  const testButton = action(
    document,
    '测试连接',
    guarded(async () => {
      document.defaultView.clearTimeout(keyTimer);
      const provider = captureConfiguration();
      const pendingKey = secret.value.trim();
      testing = new document.defaultView.AbortController();
      testButton.disabled = true;
      cancelTest.hidden = false;
      status.textContent = '正在用自制短句和图像测试，不发送文献内容…';
      try {
        provider.probe = await application.models.probe(
          provider,
          testing.signal,
          pendingKey || undefined,
        );
        if (testing.signal.aborted) return;
        const current = configuration.providers.find((entry) => entry.id === provider.id);
        if (!current || providerSignature(current) !== provider.probe.signature) return;
        if (pendingKey) {
          if (!provider.probe.text) throw new Error('连接测试未通过，请检查密钥和模型。');
          savingKey = application.secrets.set(apiKeyId(provider), pendingKey);
          await savingKey;
          if (testing.signal.aborted) return;
          secret.value = '';
          application.models.catalogs?.clear();
        }
        current.probe = provider.probe;
        application.store.saveConfiguration(configuration);
        loadProvider();
        renderProviders();
        status.textContent = '';
        for (const panel of application.panels.values()) panel.updateCapability();
      } catch (error) {
        if (testing.signal.aborted) return;
        provider.probe = {
          signature: providerSignature(provider),
          text: false,
          vision: false,
          checkedAt: new Date().toISOString(),
        };
        const current = configuration.providers.find((entry) => entry.id === provider.id);
        if (providerSignature(current) === provider.probe.signature) {
          current.probe = provider.probe;
          application.store.saveConfiguration(configuration);
        }
        renderProviders();
        throw error;
      } finally {
        savingKey = null;
        testing = null;
        testButton.disabled = false;
        cancelTest.hidden = true;
      }
    }),
    { class: 'rc-button', title: '用自制短句和图像测试文本与读图，不发送文献内容' },
  );
  const saveKey = action(document, '保存密钥', () => testButton.click(), { class: 'rc-button' });
  secret.addEventListener('input', () => {
    document.defaultView.clearTimeout(keyTimer);
    testing?.abort();
    if (secret.value.trim())
      keyTimer = document.defaultView.setTimeout(() => testButton.click(), 500);
  });
  keyRow.append(secret, saveKey);
  removeKey = action(
    document,
    '删除密钥',
    guarded(async () => {
      document.defaultView.clearTimeout(keyTimer);
      testing?.abort();
      const provider = configuration.providers.find((entry) => entry.id === picker.value);
      await application.secrets.set(apiKeyId(provider), '');
      secret.value = '';
      application.models.catalogs?.clear();
      success('这个服务商的密钥已删除。');
    }),
    { class: 'rc-link' },
  );
  const destination = element(document, 'select');
  const zotero = application.environment.Zotero;
  for (const library of zotero.Libraries.getAll().filter((entry) => entry.editable)) {
    const targets = [
      { name: `${library.name} / 不分类`, id: null },
      ...zotero.Collections.getByLibrary(library.libraryID),
    ];
    for (const collection of targets) {
      const value = JSON.stringify({ libraryID: library.libraryID, collectionID: collection.id });
      destination.append(element(document, 'option', collection.name, { value }));
    }
  }
  destination.value = JSON.stringify({
    libraryID: configuration.libraryID || zotero.Libraries.userLibraryID,
    collectionID: configuration.collectionID,
  });
  destination.addEventListener('change', () => {
    Object.assign(configuration, JSON.parse(destination.value));
  });
  const group = (title, description) => {
    const section = element(document, 'section', null, { class: 'rc-settings-group' });
    section.append(element(document, 'h3', title));
    if (description) section.append(element(document, 'p', description));
    root.append(section);
    return section;
  };
  const fold = (title, content) => {
    const box = element(document, 'div');
    content.hidden = true;
    const toggle = action(
      document,
      title,
      () => {
        content.hidden = !content.hidden;
        toggle.setAttribute('aria-expanded', String(!content.hidden));
      },
      { class: 'rc-disclosure', 'aria-expanded': 'false' },
    );
    toggle.prepend(icon(document, 'down'));
    box.append(toggle, content);
    return box;
  };
  const renderProviders = () => {
    const focused = editor.contains(document.activeElement) ? document.activeElement : null;
    providerList.replaceChildren();
    for (const provider of configuration.providers) {
      const capabilities = modelCapabilities(provider);
      const open = picker.value === provider.id && !editor.hidden;
      const row = action(
        document,
        '',
        () => {
          const same = picker.value === provider.id && !editor.hidden;
          picker.value = provider.id;
          loadProvider();
          editor.hidden = same;
          renderProviders();
        },
        {
          class: 'rc-provider-row',
          'aria-expanded': String(open),
          'data-provider': provider.id,
        },
      );
      const state = !capabilities.verified ? 'untested' : capabilities.text ? 'passed' : 'failed';
      row.append(
        element(document, 'i', null, {
          class: 'rc-provider-status',
          'data-status': state,
          'aria-label': { untested: '未测试', passed: '通过', failed: '失败' }[state],
        }),
        element(document, 'span', provider.name),
        element(
          document,
          'small',
          [
            provider.model ? modelLabel(provider.model) : '',
            state === 'passed'
              ? capabilities.vision
                ? '可用 · 能读图'
                : '可用'
              : state === 'failed'
                ? '连接失败'
                : '未测试',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        icon(document, 'right'),
      );
      const header = element(document, 'div', null, { class: 'rc-provider-header' });
      const remove = action(document, '删除', () => showDeletion(provider, header, remove), {
        class: 'rc-remove-provider',
        'aria-label': '删除 ' + provider.name,
        'data-remove-provider': provider.id,
      });
      header.append(row, remove);
      providerList.append(header);
      if (picker.value === provider.id) providerList.append(editor);
    }
    focused?.focus({ preventScroll: true });
  };

  const models = group('模型', 'Scholia 通过这些服务商回答问题。点开一行可以修改密钥和模型。');
  const advanced = element(document, 'div');
  advanced.append(
    pathField,
    advancedAddress,
    labeledControl(document, '上下文长度', context),
    labeledControl(document, '超时秒数', timeout),
  );
  const providerActions = element(document, 'div', null, { class: 'rc-actions' });
  const showDeletion = (provider, header, remove) => {
    const remaining = configuration.providers.filter((entry) => entry.id !== provider.id);
    const fallback =
      remaining.find((entry) => entry.id === configuration.routes.ask) || remaining[0];
    const routed = Object.values(configuration.routes).includes(provider.id);
    const routeNotice = routed
      ? fallback
        ? `使用它的任务将切换至“${fallback.name}”。`
        : '添加新配置后可继续使用模型。'
      : '';
    const confirm = action(
      document,
      '确认删除',
      guarded(async () => {
        confirm.disabled = true;
        document.defaultView.clearTimeout(keyTimer);
        testing?.abort();
        authorizing?.abort();
        try {
          if (savingKey) await savingKey.catch(() => {});
          if (accountPending) await accountPending.catch(() => {});
          // Read the current store so a deletion cannot overwrite other saved connections.
          const next = application.store.configuration();
          next.providers = next.providers.filter((entry) => entry.id !== provider.id);
          const replacement =
            next.providers.find((entry) => entry.id === fallback?.id) || next.providers[0];
          for (const purpose of Object.keys(next.routes))
            if (next.routes[purpose] === provider.id) next.routes[purpose] = replacement?.id || '';
          application.secrets.removeProvider(provider.id);
          application.models.google.forget(provider.id);
          application.store.saveConfiguration(next);
          configuration = next;
          application.models.catalogs?.clear();
          if (readChoice()?.providerId === provider.id) storeChoice(null);
          for (const panel of application.panels.values()) {
            panel.modelMenu.close();
            panel.modelMenu.defaultModel = null;
            panel.refreshModels();
          }
          updateChoices();
          loadProvider();
          editor.hidden = true;
          renderProviders();
          success('已删除“' + provider.name + '”。');
        } finally {
          confirm.disabled = false;
        }
      }),
      { class: 'rc-button' },
    );
    const credentials =
      provider.type === 'google-oauth'
        ? '及本地登录凭据'
        : provider.type === 'codex'
          ? ''
          : '及已保存的 API 密钥';
    deletion.replaceChildren(
      element(document, 'p', `删除“${provider.name}”的配置${credentials}？${routeNotice}`),
      confirm,
      action(document, '取消', () => {
        deletion.hidden = true;
        remove.focus();
      }),
    );
    header.after(deletion);
    deletion.hidden = false;
    confirm.focus();
  };
  providerActions.append(testButton, cancelTest, removeKey);
  editor.append(
    googleControls,
    labeledControl(document, '服务商', kind),
    labeledControl(document, '显示名称', name),
    addressSlot,
    keyField,
    labeledControl(document, '默认模型', model),
    customModel,
    modelReason,
    effortField,
    fold('高级', advanced),
    providerActions,
  );
  const accountLogin = (type) =>
    guarded(async () => {
      if (authorizing) return;
      const setup = application.setup;
      const controller = new document.defaultView.AbortController();
      const signal = controller.signal;
      authorizing = controller;
      for (const button of loginButtons) button.disabled = true;
      setup.controllers.add(controller);
      const cancel = action(document, '取消登录', () => controller.abort(), { class: 'rc-link' });
      const onProgress = (text) =>
        status.replaceChildren(document.createTextNode(text + ' '), cancel);
      onProgress('正在打开账号登录…');
      accountPending = (async () => {
        if (type === 'codex')
          return setup.login(document.defaultView, { signal, onProgress, select: false });
        const provider = setup.googleProvider();
        await application.models.google.login(document.defaultView, provider, signal, onProgress);
        signal.throwIfAborted();
        setup.save(provider, false);
        return provider;
      })();
      setup.pending.add(accountPending);
      try {
        const provider = await accountPending;
        signal.throwIfAborted();
        configuration = application.store.configuration();
        updateChoices();
        picker.value = provider.id;
        loadProvider();
        editor.hidden = false;
        renderProviders();
        for (const panel of application.panels.values()) panel.refreshModels();
        success(provider.name + '已连接。');
      } catch (error) {
        if (signal.aborted) success('已取消登录。');
        else throw error;
      } finally {
        setup.controllers.delete(controller);
        setup.pending.delete(accountPending);
        authorizing = null;
        accountPending = null;
        for (const button of loginButtons) button.disabled = false;
      }
    });
  googleControls.append(
    action(
      document,
      '打开 Gemini 网页版',
      () => application.environment.Zotero.launchURL('https://gemini.google.com/app'),
      { class: 'rc-link' },
    ),
  );
  const editPreset = (preset, reuse) => {
    let provider =
      reuse && configuration.providers.find((entry) => providerKind(entry) === preset.id);
    if (!provider) {
      const next = clone(configuration);
      const id =
        reuse && !next.providers.some((entry) => entry.id === preset.id)
          ? preset.id
          : 'custom-' + application.identifier();
      provider = { ...preset, id };
      next.providers.push(provider);
      if (next.providers.length === 1)
        for (const purpose of Object.keys(routes)) next.routes[purpose] = id;
      application.store.saveConfiguration(next);
      configuration = next;
    }
    updateChoices();
    picker.value = provider.id;
    loadProvider();
    editor.hidden = false;
    renderProviders();
  };
  const connections = element(document, 'div', null, { class: 'rc-actions' });
  const loginButtons = [
    action(document, 'Codex · 用 ChatGPT 登录', accountLogin('codex'), { class: 'rc-button' }),
    action(document, 'Gemini · 用 Google 登录', accountLogin('google-oauth'), {
      class: 'rc-button',
    }),
  ];
  connections.append(...loginButtons);
  for (const preset of apiPresets.filter((entry) => ['gemini', 'openai'].includes(entry.id)))
    connections.append(
      action(
        document,
        preset.name,
        guarded(() => editPreset(preset, true)),
        { class: 'rc-button', title: '配置 ' + preset.name },
      ),
    );
  const addProvider = labeledAction(
    document,
    '新增服务商',
    'plus',
    guarded(() => {
      const preset = apiPresets.find(
        (entry) => !configuration.providers.some((provider) => providerKind(provider) === entry.id),
      );
      editPreset(preset || apiPresets[0], false);
    }),
    { class: 'rc-link rc-add-provider' },
  );
  const routeFields = element(document, 'div', null, { class: 'rc-route-fields' });
  const each = element(document, 'div');
  each.append(
    labeledControl(document, '提问和总结', routes.ask),
    labeledControl(document, '翻译整页', routes.translate),
    labeledControl(document, '看图', routes.vision),
    labeledControl(document, '选中文字翻译', routes.selection),
  );
  routeFields.append(
    element(
      document,
      'p',
      '一般不用改。想让翻译走便宜的服务、提问走更强的服务时，可以在这里分开指定。',
      { class: 'rc-muted' },
    ),
    labeledControl(document, '全部使用同一个', shared),
    fold('分别选择', each),
  );
  for (const route of Object.values(routes)) route.addEventListener('change', syncShared);
  shared.addEventListener('change', () => {
    for (const route of Object.values(routes)) route.value = shared.value;
  });
  models.append(
    connections,
    providerList,
    addProvider,
    fold('不同任务用不同的服务商', routeFields),
  );
  const translation = group('翻译', '划词即译，页面翻译保留原文对照。');
  const language = element(document, 'select');
  for (const value of new Set([
    '中文',
    'English',
    '日本語',
    'Deutsch',
    'Français',
    configuration.translation?.language || '中文',
  ]))
    language.append(element(document, 'option', value, { value }));
  language.value = configuration.translation?.language || '中文';
  const trigger = element(document, 'select');
  for (const [value, label] of [
    ['auto', '选中即译'],
    ['click', '点图标翻译'],
    ['off', '关闭'],
  ]) {
    trigger.append(element(document, 'option', label, { value }));
  }
  trigger.value = configuration.translation?.trigger || 'auto';
  const annotationComment = element(document, 'input', null, { type: 'checkbox' });
  annotationComment.checked = configuration.translation?.annotationComment !== false;
  translation.append(
    labeledControl(document, '目标语言', language),
    labeledControl(document, '划词翻译', trigger),
    labeledControl(document, '高亮评论中保存译文', annotationComment),
    action(
      document,
      '打开本篇术语表',
      () => {
        const workspace = application.openReaderWorkspace(
          application.environment.Zotero.getMainWindow(),
        );
        workspace.panel.showGlossary();
        document.defaultView.close();
      },
      { class: 'rc-link' },
    ),
  );
  const web = group('网页保存', '浏览器扩展保存的条目放在这里。');
  web.append(
    labeledControl(document, '保存位置', destination),
    action(
      document,
      '复制浏览器配对码',
      guarded(async () => {
        const pairing = await application.secrets.get('browser-pairing');
        zotero.Utilities.Internal.copyTextToClipboard(pairing);
        success(`配对码已复制。浏览器扩展的端口填写 ${zotero.Server.port}。`);
      }),
      { class: 'rc-button' },
    ),
  );
  root.append(status);
  renderProviders();
  const apply = (event) => {
    if (event.target === secret || event.target === effort) return;
    testing?.abort();
    try {
      captureConfiguration();
      updateChoices();
      renderProviders();
      event.target.removeAttribute('aria-invalid');
      success('已自动应用。');
    } catch (error) {
      event.target.setAttribute('aria-invalid', 'true');
      status.replaceChildren(
        document.createTextNode('尚未应用：' + error.message),
        errorControls(
          document,
          application,
          errorFeedback(error, typeOf()),
          configuration.providers.find((entry) => entry.id === picker.value),
        ),
      );
    }
  };
  root.addEventListener('change', apply);
  document.defaultView.addEventListener(
    'unload',
    () => {
      document.defaultView.clearTimeout(keyTimer);
      testing?.abort();
      authorizing?.abort();
    },
    { once: true },
  );
}
