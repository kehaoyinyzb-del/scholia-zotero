import { element, action } from './dom.js';
import { icon } from './icons.js';
import { catalogKey } from '../domain/configuration.js';

export const effortNames = {
  none: '无',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
  ultra: '极限',
};
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const tierNames = { fast: '快', standard: '标准', deep: '深入' };

/** "GPT-6.1-Sol" and "GPT-6.1 Sol" are the same family; show them one way. */
export function modelLabel(name) {
  return String(name || '').replace(/^(GPT-\d+(?:\.\d+)?)-(?=[A-Za-z])/u, '$1 ');
}

function sortedEfforts(model) {
  const values = (model.supportedReasoningEfforts || []).map((entry) => entry.reasoningEffort);
  return values.sort((a, b) => {
    const left = effortOrder.indexOf(a);
    const right = effortOrder.indexOf(b);
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
  });
}

/** Fast, standard and deep map onto what this model actually supports. */
export function effortTiers(model) {
  const values = sortedEfforts(model);
  if (values.length < 2) return [];
  // A provider may default to its fastest level; "standard" still needs a distinct
  // middle choice, and "deep" must never map below it.
  const standard = values.includes('medium') ? 'medium' : values[Math.floor(values.length / 2)];
  const deep = values.indexOf('high') > values.indexOf(standard) ? 'high' : values.at(-1);
  const tiers = [];
  for (const [tier, value] of [
    ['fast', values[0]],
    ['standard', standard],
    ['deep', deep],
  ]) {
    if (tiers.some((entry) => entry.value === value)) continue;
    tiers.push({ tier, value, label: tierNames[tier] });
  }
  return tiers.length > 1 ? tiers : [];
}

function legacyTier(effort) {
  if (['none', 'minimal', 'low'].includes(effort)) return 'fast';
  if (['high', 'xhigh', 'max', 'ultra'].includes(effort)) return 'deep';
  return 'standard';
}

export class ModelMenu {
  constructor(panel) {
    this.panel = panel;
    this.application = panel.application;
    this.document = panel.document;
    this.preference = 'extensions.readingCompanion.chatModel.v1';
    try {
      this.selected = JSON.parse(
        this.application.environment.Zotero.Prefs.get(this.preference, true),
      );
    } catch {
      this.selected = null;
    }
    this.root = element(this.document, 'div', null, {
      class: 'rc-menu rc-model-menu',
      role: 'dialog',
      'aria-label': '选择模型',
      hidden: '',
    });
    this.search = element(this.document, 'input', null, {
      type: 'search',
      placeholder: '搜索模型或服务商',
      'aria-label': '搜索模型或服务商',
    });
    this.list = element(this.document, 'div', null, { class: 'rc-model-list', role: 'menu' });
    this.footer = element(this.document, 'div', null, { class: 'rc-model-footer' });
    this.root.append(this.search, this.list, this.footer);
    this.search.addEventListener('input', () => this.render(this.groups));
    this.button = action(this.document, '默认模型', () => this.toggle(), {
      class: 'rc-model-button',
      title: '选择模型和思考深度',
      'aria-expanded': 'false',
    });
    this.updateLabel();
    const configuration = this.application.store.configuration();
    const provider = configuration.providers.find((entry) => entry.id === configuration.routes.ask);
    if (!this.selected && provider?.type === 'codex' && this.application.models) {
      this.application.models.catalog(provider).then((catalog) => {
        this.defaultModel = catalog.models.find((model) => model.isDefault);
        this.updateLabel();
      });
    }
  }

  provider(fallback) {
    const configuration = this.application.store.configuration();
    const selected = this.selected;
    const provider = configuration.providers.find((entry) => entry.id === selected?.providerId);
    if (!provider)
      return this.defaultModel && fallback?.type === 'codex' && !fallback.model
        ? {
            ...fallback,
            model: this.defaultModel.model,
            displayName: this.defaultModel.displayName,
            effort: this.defaultModel.defaultReasoningEffort,
            inputModalities: this.defaultModel.inputModalities,
          }
        : fallback;
    return {
      ...provider,
      model: selected.model,
      effort: selected.effort,
      displayName: selected.name,
      inputModalities: selected.inputModalities,
    };
  }

  tier() {
    if (!this.selected?.effort) return 'standard';
    return this.selected.tier || legacyTier(this.selected.effort);
  }

  updateLabel() {
    const selected = this.selected;
    const configuration = this.application.store.configuration();
    const fallback = configuration.providers.find((entry) => entry.id === configuration.routes.ask);
    const name = modelLabel(
      selected?.name || fallback?.model || this.defaultModel?.displayName || '默认模型',
    );
    this.button.replaceChildren(element(this.document, 'span', name, { class: 'rc-model-name' }));
    const tier = this.tier();
    if (tier !== 'standard')
      this.button.append(
        element(this.document, 'small', tierNames[tier], { class: 'rc-model-tier' }),
      );
    this.button.append(icon(this.document, 'down'));
    const suffix = tier === 'standard' ? '' : ` · ${tierNames[tier]}`;
    this.button.title = `${name}${suffix}：选择模型和思考深度`;
    this.panel.renderBasis?.(this.panel.viewState);
  }

  choose(provider, model, effort, tier) {
    const chosenTier = tier || (this.selected ? this.tier() : 'standard');
    const tiers = effortTiers(model);
    const mapped = effort || tiers.find((entry) => entry.tier === chosenTier)?.value;
    this.selected = {
      providerId: provider.id,
      model: model.model,
      name: model.displayName || model.model || '默认模型',
      effort: mapped || model.defaultReasoningEffort || null,
      tier: tiers.length ? tiers.find((entry) => entry.value === mapped)?.tier || 'standard' : null,
      inputModalities: model.inputModalities,
    };
    this.application.environment.Zotero.Prefs.set(
      this.preference,
      JSON.stringify(this.selected),
      true,
    );
    this.updateLabel();
    for (const panel of this.application.panels?.values() || []) {
      if (panel === this.panel) continue;
      panel.modelMenu.selected = this.selected;
      panel.modelMenu.updateLabel();
      panel.modelMenu.close();
    }
    this.close();
    this.button.focus();
  }

  close() {
    this.root.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }

  current(groups) {
    const configuration = this.application.store.configuration();
    const selected = this.provider(
      configuration.providers.find((entry) => entry.id === configuration.routes.ask),
    );
    for (const { provider, catalog } of groups) {
      if (provider.id !== selected?.id) continue;
      const model = catalog.models.find((entry) => entry.model === selected.model);
      if (model) return { provider, model };
    }
    return null;
  }

  toggle() {
    if (!this.root.hidden) {
      this.close();
      return;
    }
    this.search.value = '';
    this.panel.secondary.hidden = true;
    this.root.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    // Render at once from whatever is known; each service refreshes its own rows when its
    // catalog arrives, so one slow or broken service never holds the menu closed.
    const providers = this.application.store.configuration().providers;
    const cache = this.application.models.catalogs;
    this.groups = providers.map((provider) => ({
      provider,
      catalog: cache?.get(catalogKey(provider)) || null,
    }));
    const groups = this.groups;
    this.render(groups);
    this.list.scrollTop = 0;
    this.search.focus();
    for (const group of groups) {
      if (group.catalog) continue;
      this.application.models
        .catalog(group.provider)
        .catch(() => ({ models: [], disabled: true }))
        .then((catalog) => {
          group.catalog = catalog;
          if (!this.root.hidden && this.groups === groups) this.render(groups);
        });
    }
  }

  render(groups) {
    const document = this.document;
    this.list.replaceChildren();
    this.footer.replaceChildren();
    const query = this.search.value.trim().toLowerCase();
    const configuration = this.application.store.configuration();
    const chosen = this.provider(
      configuration.providers.find((entry) => entry.id === configuration.routes.ask),
    );
    // Unconfigured services belong in Settings, not in a menu for switching models.
    const usable = groups
      .filter(({ provider, catalog }) =>
        catalog ? provider.type === 'codex' || !catalog.disabled : provider.id === chosen?.id,
      )
      .sort((a, b) => (b.provider.id === chosen?.id) - (a.provider.id === chosen?.id));
    const known = usable.filter((group) => group.catalog);
    const current = this.current(known);
    for (const { provider, catalog } of usable) {
      if (!catalog) {
        this.list.append(
          element(document, 'p', '正在读取模型…', { class: 'rc-menu-note rc-menu-loading' }),
        );
        continue;
      }
      const models = catalog.models.filter((model) =>
        [provider.name, model.displayName, model.model].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(query),
        ),
      );
      if (!models.length) continue;
      if (usable.length > 1)
        this.list.append(element(document, 'h4', provider.name, { class: 'rc-menu-label' }));
      if (catalog.reason)
        this.list.append(element(document, 'p', catalog.reason, { class: 'rc-menu-note' }));
      for (const model of models) {
        const name = modelLabel(model.displayName || model.model || '默认模型');
        const pressed =
          this.selected?.providerId === provider.id
            ? this.selected.model === model.model
            : current?.provider.id === provider.id && current.model === model;
        const button = action(document, '', () => this.choose(provider, model), {
          class: 'rc-model-option',
          role: 'menuitemradio',
          title: model.description || name,
          'aria-checked': String(Boolean(pressed)),
          'aria-pressed': String(Boolean(pressed)),
        });
        button.disabled = Boolean(catalog.disabled);
        button.append(element(document, 'span', name));
        if (pressed) button.append(icon(document, 'check'));
        this.list.append(button);
      }
    }
    if (!this.list.childElementCount)
      this.list.append(
        element(document, 'p', query ? '没有匹配的模型' : '请先连接服务商', {
          class: 'rc-menu-note',
        }),
      );
    const tiers = current ? effortTiers(current.model) : [];
    if (tiers.length) {
      this.footer.append(element(document, 'hr'));
      const row = element(document, 'div', null, {
        class: 'rc-effort-row',
        title: '思考越深，回答越慢、消耗额度越多',
      });
      const segments = element(document, 'div', null, {
        class: 'rc-efforts',
        role: 'radiogroup',
        'aria-label': '思考深度',
      });
      const active =
        tiers.find((entry) => entry.value === this.provider(current.provider)?.effort)?.tier ||
        'standard';
      for (const entry of tiers)
        segments.append(
          action(
            document,
            entry.label,
            () => this.choose(current.provider, current.model, entry.value, entry.tier),
            {
              role: 'radio',
              title: `${entry.label}（${entry.value}）`,
              'aria-checked': String(entry.tier === active),
              'aria-pressed': String(entry.tier === active),
            },
          ),
        );
      row.append(element(document, 'span', '思考深度'), segments);
      this.footer.append(row);
    }
    this.footer.append(element(document, 'hr'));
    this.footer.append(
      action(
        document,
        '模型与服务商设置…',
        () => {
          this.close();
          this.application.openSettings();
        },
        { class: 'rc-menu-more' },
      ),
    );
  }
}
