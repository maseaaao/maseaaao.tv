/**
 * Выкладка Dock без Vue: статические узлы строятся один раз, ветки
 * (auth/setup/content/empty/save-panel/modal) пересоздаются только при смене
 * ветки, списки — keyed-синхронизацией, чтобы сохранять фокус, IME-состав,
 * выделение и скролл. Эта разметка — единственный источник DOM.
 */
import STREAMERBOT_IMPORT from '../streamerbot-import.txt?raw';
import { rankCategories } from './category-search';
import { createStreamInfo, type Notice, type PresetAction } from './controller';
import { type AppIcon, anyIcon, uiIcon } from './icons';
import { t } from './messages';
import { subscribe } from './reactive';
import { isTemplateValid } from './templates';
import type { TwitchCategory } from './types';

export interface Dock {
  dispose(): void;
}

const SETUP_STATUSES: ReadonlyArray<string> = ['missing', 'disabled', 'outdated'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttribute(node: Element, name: string, value: string | boolean | null): void {
  if (value === null || value === false) node.removeAttribute(name);
  else {
    const text = typeof value === 'boolean' ? 'true' : value;
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  }
}

// Static SVG from bundled imports only: never API data or user input.
function icon(name: AppIcon, className = ''): HTMLSpanElement {
  const span = el('span', className ? `app-icon ${className}` : 'app-icon');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = anyIcon(name);
  return span;
}

interface AppButton {
  root: HTMLButtonElement;
  label: HTMLSpanElement;
}

function appButton(
  variant: 'primary' | 'secondary' | 'icon',
  content: { label?: string; icon?: AppIcon; ariaLabel?: string },
): AppButton {
  const root = el('button', `app-button app-button--press app-button--${variant}`);
  root.type = 'button';
  if (content.ariaLabel) root.setAttribute('aria-label', content.ariaLabel);
  const label = el('span', 'app-button__label');
  if (content.icon) {
    const box = el('span', 'app-button__icon');
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = anyIcon(content.icon);
    root.append(box, label);
  } else {
    root.append(label);
  }
  if (content.label) setText(label, content.label);
  return { root, label };
}

interface Field {
  root: HTMLDivElement;
  input: HTMLInputElement | HTMLTextAreaElement;
}

interface FieldSpec {
  id: string;
  label: string;
  type?: 'text' | 'password' | 'number';
  autocomplete?: string;
  placeholder?: string;
  multiline?: boolean;
  readonly?: boolean;
  min?: number;
  max?: number;
}

function buildField(spec: FieldSpec): Field {
  const root = el('div', 'field-input');
  const label = el('label', 'field-input__label');
  label.setAttribute('for', spec.id);
  setText(label, spec.label);
  const control = el<'input' | 'textarea'>(
    spec.multiline ? 'textarea' : 'input',
    'field-input__control',
  );
  control.id = spec.id;
  if (spec.multiline) {
    const area = control as HTMLTextAreaElement;
    if (spec.readonly) area.readOnly = true;
  } else {
    const input = control as HTMLInputElement;
    input.type = spec.type ?? 'text';
    if (typeof spec.min === 'number') input.min = String(spec.min);
    if (typeof spec.max === 'number') input.max = String(spec.max);
    if (spec.autocomplete) input.setAttribute('autocomplete', spec.autocomplete);
    if (spec.readonly) input.readOnly = true;
  }
  if (spec.placeholder) control.placeholder = spec.placeholder;
  root.append(label, control);
  return { root, input: control };
}

function patchField(field: Field, value: string, disabled: boolean): void {
  if (field.input.value !== value) field.input.value = value;
  setAttribute(field.input, 'disabled', disabled);
}

function composeClass(base: string, extra: Array<string | false | null | undefined>): string {
  return [base, ...extra.filter(Boolean)].join(' ');
}

/** Keyed-синхронизатор: убирает лишнее и двигает узлы только при смене порядка. */
function syncChildren(container: HTMLElement, next: readonly Element[]): void {
  const wanted = new Set<Element>(next);
  for (const child of [...container.children]) if (!wanted.has(child)) child.remove();
  const current = [...container.children];
  if (next.length === current.length && next.every((node, index) => current[index] === node))
    return;
  let cursor: Element | null = container.firstElementChild;
  for (const node of next) {
    if (cursor === node) {
      cursor = cursor.nextElementSibling;
      continue;
    }
    if (cursor) container.insertBefore(node, cursor);
    else container.append(node);
  }
}

interface Cover {
  root: HTMLSpanElement;
  update(src: string): void;
}

function buildCover(): Cover {
  const root = el('span', 'category-cover');
  let current: string | null = null;
  let failed = false;
  const fallback = icon('defaultCategory');

  function render(src: string | null): void {
    root.replaceChildren();
    if (src && !failed) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      img.width = 48;
      img.height = 64;
      img.addEventListener('error', () => {
        if (img.getAttribute('src') === current) {
          failed = true;
          render(current);
        }
      });
      root.append(img);
    } else {
      root.append(fallback);
    }
  }

  return {
    root,
    update(src: string): void {
      if (src === current) return;
      current = src;
      failed = false;
      render(src);
    },
  };
}

interface SearchInput {
  selected: TwitchCategory | null;
  query: string;
  results: TwitchCategory[];
  disabled: boolean;
  loading: boolean;
  error: string | null;
  partial: boolean;
  warnings: string[];
  hasMore: boolean;
  limit: number;
}

interface SearchHooks {
  onQuery(value: string, composing: boolean): void;
  onChoose(id: string): void;
  onRetry(): void;
  onMore(): void;
  onCompositionStart(): void;
}

/**
 * Поиск категорий: input живёт всегда, popover — «эпизод» раскрытия, поэтому
 * скролл списка и фокус на сохранённых опциях не теряются между выкладками.
 */
function buildCategorySearch(
  prefix: string,
  hooks: SearchHooks,
): {
  root: HTMLDivElement;
  input: HTMLInputElement;
  update(values: SearchInput): void;
} {
  const root = el('div', 'autocomplete');
  const selectedBox = el('div', 'selected-category');
  const selectedCover = buildCover();
  const selectedName = el('strong');
  selectedBox.append(selectedCover.root, selectedName);
  const label = el('label', 'category-label');
  label.setAttribute('for', `${prefix}-input`);
  setText(label, t('category'));
  const input = el('input', 'category-query');
  input.id = `${prefix}-input`;
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', `${prefix}-list`);
  root.append(selectedBox, label, input);

  const popover = el('div', 'category-popover');
  const list = el('div', 'autocomplete-list');
  list.id = `${prefix}-list`;
  list.setAttribute('role', 'listbox');
  setAttribute(list, 'aria-label', t('category'));
  const status = el('p', 'category-search-status');
  const warning = el('div', 'category-search-warning');
  warning.setAttribute('role', 'status');
  const warningHead = el('span');
  const warningLines = el('div');
  warning.append(warningHead, warningLines);
  const actions = el('div', 'category-search-actions');
  const retry = appButton('secondary', { label: t('categoryRetry') });
  const more = appButton('secondary', { label: t('categoryMore') });
  popover.append(list, status, warning, actions);
  retry.root.addEventListener('click', () => hooks.onRetry());
  more.root.addEventListener('click', () => {
    if (!valuesSnapshot.loading) hooks.onMore();
  });

  let valuesSnapshot: SearchInput = {
    selected: null,
    query: '',
    results: [],
    disabled: false,
    loading: false,
    error: null,
    partial: false,
    warnings: [],
    hasMore: false,
    limit: 20,
  };
  let composing = false;
  let activeId: string | null = null;
  let prevQuery = '';
  let expanded = false;
  let selectedShown: string | null = null;
  const optionNodes = new Map<
    string,
    { node: HTMLButtonElement; cover: Cover; name: HTMLElement }
  >();

  function optionId(id: string): string {
    return `${prefix}-option-${encodeURIComponent(id)}`;
  }

  function rankedRanked(): TwitchCategory[] {
    return rankCategories(valuesSnapshot.results, valuesSnapshot.query);
  }

  function visible(): TwitchCategory[] {
    return rankedRanked().slice(0, valuesSnapshot.limit);
  }

  function moreAvailable(): boolean {
    return rankedRanked().length > valuesSnapshot.limit || valuesSnapshot.hasMore;
  }

  function refocusInputAfterRender(): void {
    queueMicrotask(() => {
      if (document.activeElement === document.body && !input.disabled && input.isConnected) {
        input.focus();
      }
    });
  }

  function choose(id: string): void {
    activeId = null;
    hooks.onChoose(id);
    refocusInputAfterRender();
  }

  function syncOptions(visibleList: TwitchCategory[]): void {
    if (activeId && !visibleList.some((option) => option.id === activeId)) activeId = null;
    setAttribute(input, 'aria-activedescendant', expanded && activeId ? optionId(activeId) : null);
    for (const [id, cached] of optionNodes) {
      setAttribute(
        cached.node,
        'aria-selected',
        expanded && activeId === id && visibleList.some((option) => option.id === id),
      );
    }
  }

  input.addEventListener('input', () => {
    hooks.onQuery(input.value, composing);
  });
  input.addEventListener('keydown', (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.isComposing || composing || valuesSnapshot.disabled) return;
    if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
      key.preventDefault();
      const visibleList = visible();
      const index = visibleList.findIndex((option) => option.id === activeId);
      const direction = key.key === 'ArrowDown' ? 1 : -1;
      const next =
        index < 0
          ? direction === 1
            ? 0
            : visibleList.length - 1
          : (index + direction + visibleList.length) % visibleList.length;
      activeId = visibleList[next]?.id ?? null;
      syncOptions(visibleList);
      input.focus();
      if (activeId)
        document.getElementById(optionId(activeId))?.scrollIntoView?.({ block: 'nearest' });
    } else if (key.key === 'Enter' && activeId) {
      key.preventDefault();
      choose(activeId);
    } else if (key.key === 'Escape') {
      key.preventDefault();
      hooks.onQuery('', false);
      refocusInputAfterRender();
    }
  });
  input.addEventListener('compositionstart', () => {
    composing = true;
    hooks.onCompositionStart();
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    hooks.onQuery(input.value, false);
  });

  return {
    root,
    input,
    update(values: SearchInput): void {
      valuesSnapshot = values;
      if (values.query !== prevQuery) {
        activeId = null;
        prevQuery = values.query;
      }
      const nowExpanded = values.query.trim().length >= 2 && !values.disabled;
      if (nowExpanded && !expanded) {
        expanded = true;
        root.append(popover);
      } else if (!nowExpanded && expanded) {
        expanded = false;
        activeId = null;
        popover.remove();
      }
      if (values.selected) {
        if (selectedShown === null) root.insertBefore(selectedBox, label);
        selectedShown = values.selected.id;
        selectedCover.update(values.selected.imageUrl);
        setText(selectedName, values.selected.name);
      } else if (selectedShown !== null) {
        selectedBox.remove();
        selectedShown = null;
      }
      const visibleList = visible();
      patchField({ root, input }, values.query, values.disabled);
      input.placeholder = values.selected ? t('categorySearchOther') : t('categorySearch');
      setAttribute(input, 'aria-expanded', nowExpanded);
      if (expanded) {
        const nodes: HTMLButtonElement[] = [];
        for (const category of visibleList) {
          let cached = optionNodes.get(category.id);
          if (!cached) {
            const node = el('button', 'category-option');
            node.id = optionId(category.id);
            node.type = 'button';
            node.setAttribute('role', 'option');
            node.addEventListener('click', () => choose(category.id));
            const cover = buildCover();
            const name = el('strong');
            node.append(cover.root, name);
            cached = { node, cover, name };
            optionNodes.set(category.id, cached);
          }
          cached.cover.update(category.imageUrl);
          setText(cached.name, category.name);
          nodes.push(cached.node);
        }
        syncChildren(list, nodes);
        for (const [id, cached] of [...optionNodes]) {
          if (!visibleList.some((option) => option.id === id)) {
            cached.node.remove();
            optionNodes.delete(id);
          }
        }
      }
      syncOptions(visibleList);
      const info = values.loading
        ? { text: t('categorySearching'), alert: false }
        : values.error
          ? { text: values.error, alert: true }
          : !visibleList.length && !moreAvailable()
            ? { text: t('nothingFound'), alert: false }
            : { text: t('categoryResultCount', { count: visibleList.length }), alert: false };
      setAttribute(status, 'role', info.alert ? 'alert' : 'status');
      setAttribute(status, 'aria-live', 'polite');
      setText(status, info.text);
      if (values.partial) {
        if (!warningHead.isConnected) warning.append(warningHead, warningLines);
        setText(warningHead, t('categoryPartial'));
        const wanted = new Set(values.warnings);
        for (const node of [...warningLines.children]) {
          if (!wanted.has(node.textContent ?? '')) node.remove();
        }
        for (const line of values.warnings) {
          const existing = [...warningLines.children].some((node) => node.textContent === line);
          if (existing) continue;
          const node = el('p');
          setText(node, line);
          warningLines.append(node);
        }
      } else if (warningHead.isConnected) {
        warningHead.remove();
        warningLines.remove();
      }
      const moreNow = moreAvailable();
      // Активный элемент фиксируем до удаления: после remove браузер сам
      // может вернуть фокус в body.
      const actionFocus =
        document.activeElement === more.root || document.activeElement === retry.root
          ? (document.activeElement as HTMLElement)
          : null;
      if (values.error) {
        if (!retry.root.isConnected) actions.append(retry.root);
      } else if (retry.root.isConnected) {
        retry.root.remove();
      }
      if (moreNow) {
        if (!more.root.isConnected) actions.append(more.root);
        const wantedAria = values.loading ? 'true' : 'false';
        if (more.root.getAttribute('aria-disabled') !== wantedAria) {
          more.root.setAttribute('aria-disabled', wantedAria);
        }
      } else if (more.root.isConnected) {
        more.root.remove();
      }
      // «Повторить поиск» стоит перед «Показать ещё», когда оба присутствуют.
      if (
        retry.root.isConnected &&
        more.root.isConnected &&
        actions.lastElementChild === retry.root
      ) {
        actions.insertBefore(retry.root, more.root);
      }
      if (actionFocus && !actionFocus.isConnected) refocusInputAfterRender();
    },
  };
}

interface TemplateField {
  root: HTMLDivElement;
  update(template: string, disabled: boolean, error: string | null): void;
}

function buildTemplateField(onInput: (value: string) => void): TemplateField {
  const root = el('div', 'template-input');
  const label = el('label');
  label.setAttribute('for', 'template-field-input');
  setText(label, t('twitchTemplate'));
  const editor = el('div', 'template-input__editor');
  const highlight = el('div', 'template-input__highlight');
  highlight.setAttribute('aria-hidden', 'true');
  const input = el('input');
  input.name = 'template';
  input.id = 'template-field-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('scroll', () => {
    highlight.scrollLeft = input.scrollLeft;
  });
  input.addEventListener('input', () => {
    highlight.scrollLeft = input.scrollLeft;
  });
  const errorLine = el('p', 'template-input__error');
  errorLine.id = 'template-field-error';
  editor.append(highlight, input);
  root.append(label, editor);

  function syncEditorClasses(disabled: boolean, error: string | null): void {
    editor.className = composeClass('template-input__editor', [
      error ? 'is-invalid' : '',
      disabled ? 'is-disabled' : '',
    ]);
  }

  function syncHighlight(template: string): void {
    const parts = template.split(/(%subtitle%)/g);
    const next: Node[] = [];
    for (const part of parts) {
      if (!part) continue;
      if (part === '%subtitle%') {
        const mark = el('mark');
        setText(mark, part);
        next.push(mark);
      } else next.push(document.createTextNode(part));
    }
    const current = [...highlight.childNodes];
    const matches =
      current.length === next.length &&
      next.every((node, index) => current[index]?.isEqualNode?.(node) === true);
    if (!matches) {
      highlight.replaceChildren(...next);
    }
  }

  function removeError(): boolean {
    if (errorLine.isConnected) {
      errorLine.remove();
      return true;
    }
    return false;
  }

  return {
    root,
    update(template, disabled, errorText): void {
      if (input.value !== template) input.value = template;
      syncHighlight(template);
      setAttribute(input, 'disabled', disabled);
      syncEditorClasses(disabled, errorText);
      if (errorText) {
        if (!errorLine.isConnected) root.append(errorLine);
        setText(errorLine, errorText);
        setAttribute(input, 'aria-invalid', 'true');
        setAttribute(input, 'aria-describedby', 'template-field-error');
      } else {
        removeError();
        setAttribute(input, 'aria-invalid', null);
        setAttribute(input, 'aria-describedby', null);
      }
    },
  };
}

interface DockOptions {
  demo?: boolean;
}

export function initDock(host: Element, options: DockOptions = {}): Dock {
  const controller = createStreamInfo(options);
  const state = controller.state;
  const settings = controller.settings;
  const search = controller.search;
  let disposed = false;

  host.replaceChildren();
  const shell = el('div', 'dock-shell');
  const scrollEl = el('div', 'dock-scroll');
  host.append(shell);

  // Header -----------------------------------------------------------------
  const statusDot = el('span', 'icon-indicator__dot');
  statusDot.setAttribute('aria-hidden', 'true');
  const statusText = el('span', 'icon-indicator__label');
  const indicator = el('p', 'icon-indicator');
  indicator.setAttribute('role', 'status');
  indicator.append(statusDot, statusText);

  const title = el('h1');
  setText(title, 'Stream Info');
  const titleHolder = el('div');
  titleHolder.append(title, indicator);

  const refresh = appButton('icon', { ariaLabel: t('refresh'), icon: 'refresh' });
  const settingsButton = appButton('icon', { ariaLabel: t('settings'), icon: 'settings' });
  refresh.root.addEventListener('click', () => {
    void controller.refreshState();
  });
  settingsButton.root.addEventListener('click', () => {
    controller.openSettings();
  });
  const headerActions = el('div', 'header-actions');
  headerActions.append(refresh.root, settingsButton.root);
  const header = el('header', 'dock-header');
  header.append(titleHolder, headerActions);

  // Footer -----------------------------------------------------------------
  const versionText = el('span');
  const updatedText = el('span');
  const footer = el('footer', 'dock-footer');
  footer.append(versionText, updatedText);

  const noticesHost = el('div', 'notices');
  scrollEl.append(header, footer, noticesHost);
  shell.append(scrollEl);

  // Region switch -----------------------------------------------------------
  type MainKind = 'auth' | 'setup' | 'content' | 'empty' | null;
  let mainKind: MainKind = null;
  let mainEl: HTMLElement | null = null;
  let savePanel: HTMLElement | null = null;
  let saveStatus: HTMLParagraphElement | null = null;
  let applyButton: HTMLButtonElement | null = null;
  let errorsHost: HTMLDivElement | null = null;
  let errorsJoined = '';
  let modalBackdrop: HTMLDivElement | null = null;
  let modalKeys: {
    host: Field;
    port: Field;
    endpoint: Field;
    password: Field;
    remember: HTMLInputElement;
  } | null = null;
  let modalNoticesHost: HTMLDivElement | null = null;
  let modalExitTimer: number | null = null;
  let returnFocus: HTMLElement | null = null;

  function switchRegion(
    kind: Exclude<MainKind, null>,
    build: () => HTMLElement,
    update: () => void,
  ): void {
    if (kind !== mainKind) {
      mainEl?.remove();
      mainEl = build();
      scrollEl.insertBefore(mainEl, footer);
      mainKind = kind;
    }
    update();
  }

  // Auth region -------------------------------------------------------------
  let authTitle: HTMLElement;
  let authDescription: HTMLElement;
  let authPassword: Field;
  function buildAuth(): HTMLElement {
    const root = el('main', 'auth-panel');
    root.setAttribute('aria-label', t('authLabel'));
    const banner = el('div', 'notice notice--error');
    banner.setAttribute('role', 'alert');
    const bannerIcon = el('span', 'notice__icon');
    bannerIcon.setAttribute('aria-hidden', 'true');
    bannerIcon.innerHTML = uiIcon('warning');
    const bannerBody = el('div', 'notice__body');
    authTitle = el('strong', 'notice__title');
    authDescription = el('div', 'notice__description');
    bannerBody.append(authTitle, authDescription);
    banner.append(bannerIcon, bannerBody);
    authPassword = buildField({
      id: 'auth-password-input',
      label: t('password'),
      type: 'password',
      autocomplete: 'current-password',
    });
    authPassword.input.addEventListener('input', () => {
      settings.password = authPassword.input.value;
    });
    const connect = appButton('primary', { label: t('connect') });
    connect.root.addEventListener('click', () => {
      void controller.connect();
    });
    root.append(banner, authPassword.root, connect.root);
    return root;
  }
  function syncAuth(): void {
    setText(authTitle, t('authFailed'));
    setText(authDescription, state.connectionError || t('authHint'));
    patchField(authPassword, settings.password, false);
  }

  // Setup region --------------------------------------------------------------
  let setupTitle: HTMLElement;
  let setupEnableText: HTMLElement;
  let setupSteps: HTMLElement;
  let setupActions: HTMLElement;
  let setupCopyLabel: HTMLSpanElement;
  let setupToggleLabel: HTMLSpanElement;
  let setupImportField: Field;
  let setupRoot: HTMLElement;
  function buildSetup(): HTMLElement {
    const root = el('main', 'setup-card');
    setupRoot = root;
    setupTitle = el('h2');
    setupEnableText = el('p');
    setupSteps = el('ol');
    for (const step of [
      'Откройте Streamer.bot.',
      'Нажмите Import.',
      'Вставьте строку ниже.',
      'Завершите импорт.',
    ]) {
      const item = el('li');
      setText(item, step);
      setupSteps.append(item);
    }
    setupActions = el('div', 'setup-actions');
    const copy = appButton('primary', { label: t('copyImport'), icon: 'copy' });
    const toggle = appButton('secondary', { label: t('showImport') });
    const check = appButton('secondary', { label: t('checkAgain') });
    copy.root.addEventListener('click', () => {
      void copyImport();
    });
    toggle.root.addEventListener('click', () => {
      state.showImport = !state.showImport;
    });
    check.root.addEventListener('click', () => {
      void controller.verifyAction();
    });
    setupCopyLabel = copy.label;
    setupToggleLabel = toggle.label;
    setupActions.append(copy.root, toggle.root, check.root);
    setupEnableText.hidden = true;
    setupSteps.hidden = true;
    setupImportField = buildField({
      id: 'import-field-input',
      label: t('importAria'),
      multiline: true,
      readonly: true,
    });
    root.append(setupTitle, setupEnableText, setupSteps, setupActions, setupImportField.root);
    return root;
  }
  function syncSetup(): void {
    const disableCase = state.actionStatus === 'disabled';
    setText(
      setupTitle,
      state.actionStatus === 'outdated'
        ? t('importOutdated')
        : t('importRequired', { action: 'STREAM INFO | API' }),
    );
    setupEnableText.hidden = !disableCase;
    if (disableCase) setText(setupEnableText, t('importEnable'));
    setupSteps.hidden = disableCase;
    setText(setupCopyLabel, state.importCopied ? t('copied') : t('copyImport'));
    setText(setupToggleLabel, state.showImport ? t('hideImport') : t('showImport'));
    if (state.showImport) {
      if (!setupImportField.root.isConnected) setupRoot.append(setupImportField.root);
      patchField(setupImportField, STREAMERBOT_IMPORT, false);
    } else setupImportField.root.remove();
  }

  async function copyImport(): Promise<void> {
    let copied = false;
    try {
      await navigator.clipboard.writeText(STREAMERBOT_IMPORT);
      copied = true;
    } catch {
      if (disposed) return;
      const area = document.createElement('textarea');
      area.value = STREAMERBOT_IMPORT;
      area.setAttribute('aria-label', t('importAria'));
      document.body.append(area);
      area.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        area.remove();
      }
    }
    if (disposed) return;
    state.importCopied = copied;
    if (!copied) {
      state.notices.unshift({
        id: crypto.randomUUID(),
        title: 'Не удалось скопировать строку',
        lines: ['Покажите строку и скопируйте её вручную.'],
        kind: 'error',
      });
    }
  }

  // Content region ----------------------------------------------------------
  let card: HTMLElement;
  let cardAccountName: HTMLElement;
  let cardBadge: HTMLSpanElement;
  let cardBadgeText: Text;
  let cardLoadingNote: HTMLElement;
  let cardEditor: HTMLElement;
  let subtitleField: Field;
  let templateField: TemplateField;
  let previewSpan: HTMLElement;
  let counterText: HTMLElement;
  let templateDirty: HTMLElement;
  let tagList: HTMLElement;
  let tagField: Field;
  let categorySearch: ReturnType<typeof buildCategorySearch>;
  let accountWarning: HTMLElement;
  let streamLink: HTMLAnchorElement;
  let dashboardLink: HTMLAnchorElement;
  let presetCount: HTMLElement;
  let presetList: HTMLElement;
  let presetHint: HTMLElement;
  let cardSection: HTMLElement;
  const presetNodes = new Map<
    string,
    { node: HTMLButtonElement; label: HTMLSpanElement; shown: string }
  >();
  const chipNodes = new Map<string, HTMLElement>();
  let cardBusy = false;

  const searchHooks: SearchHooks = {
    onQuery: (value, composing) => controller.setCategoryQuery(value, composing),
    onChoose: (id) => controller.chooseCategory(id),
    onRetry: () => controller.retrySearch(),
    onMore: () => controller.moreCategories(),
    onCompositionStart: () => controller.resetCategorySearch(),
  };

  function buildContent(): HTMLElement {
    const root = el('main', 'content');
    card = el('section', 'platform-card dock-section');
    card.setAttribute('data-platform', 'twitch');
    card.setAttribute('aria-label', 'Twitch');

    const heading = el('header', 'card-heading');
    const accountHeading = el('div', 'account-heading');
    accountHeading.append(icon('twitch', 'account-icon'));
    const accountTexts = el('div');
    const accountTitle = el('h2');
    setText(accountTitle, 'Twitch');
    cardAccountName = el('p');
    accountTexts.append(accountTitle, cardAccountName);
    accountHeading.append(accountTexts);
    const badge = el('span', 'live-status-badge');
    cardBadge = badge;
    badge.setAttribute('role', 'status');
    const badgeDot = el('span', 'live-status-badge__dot');
    badgeDot.setAttribute('aria-hidden', 'true');
    cardBadgeText = document.createTextNode('');
    badge.append(badgeDot, cardBadgeText);
    heading.append(accountHeading, badge);
    card.append(heading);

    cardLoadingNote = el('p', 'field-note');
    cardLoadingNote.setAttribute('role', 'status');

    cardEditor = el('fieldset', 'inline-editor');
    const legend = el('legend', 'sr-only');
    setText(legend, `${t('editInfo')} Twitch`);
    cardEditor.append(legend);

    const titleFields = el('div', 'title-fields');
    subtitleField = buildField({
      id: 'subtitle-input',
      label: 'Название',
      placeholder: t('subtitleExample'),
    });
    subtitleField.input.name = 'title';
    subtitleField.input.autocomplete = 'off';
    subtitleField.input.addEventListener('input', () => {
      controller.setSubtitle(subtitleField.input.value);
    });
    templateField = buildTemplateField((value) => controller.setTemplate(value));
    titleFields.append(subtitleField.root, templateField.root);

    const preview = el('div', 'title-preview');
    const previewNote = el('span', 'field-note');
    setText(previewNote, t('finalTitle'));
    const previewHolder = el('strong');
    previewSpan = el('span', 'template-preview-text');
    previewHolder.append(previewSpan);
    counterText = el('span', 'counter');
    preview.append(previewNote, previewHolder, counterText);

    templateDirty = el('p', 'template-dirty');
    templateDirty.setAttribute('role', 'status');
    cardEditor.append(titleFields, preview, templateDirty);

    const searchHolder = buildCategorySearch('category', searchHooks);
    categorySearch = searchHolder;
    cardEditor.append(searchHolder.root);

    const tagEditor = el('div', 'tag-editor');
    tagField = buildField({
      id: 'tag-draft-input',
      label: t('addTag'),
      placeholder: 'Например, Русский',
    });
    tagField.input.addEventListener('input', () => {
      controller.setTagDraft(tagField.input.value);
    });
    tagField.input.addEventListener('keydown', (event: Event) => {
      const key = event as KeyboardEvent;
      const form = state.allForm;
      if (key.isComposing || cardBusy) return;
      if (key.key === 'Enter' || key.key === ',') {
        key.preventDefault();
        controller.addTag();
      } else if (
        key.key === 'Backspace' &&
        form &&
        !form.twitchTagDraft &&
        form.twitchTags.length
      ) {
        key.preventDefault();
        controller.removeTag(form.twitchTags.length - 1);
      }
    });
    tagList = el('div', 'tag-list');
    tagList.setAttribute('role', 'group');
    setAttribute(tagList, 'aria-label', 'Выбранные теги');
    tagEditor.append(tagField.root, tagList);
    accountWarning = el('p', 'account-warning');
    cardEditor.append(tagEditor, accountWarning);

    const cardFooter = el('footer', 'card-footer');
    streamLink = el('a');
    streamLink.className = 'app-button app-button--press app-button--icon';
    setAttribute(streamLink, 'aria-label', t('openStream'));
    appendIconToLink(streamLink, 'external');
    dashboardLink = el('a');
    dashboardLink.className = 'app-button app-button--press app-button--icon';
    setAttribute(dashboardLink, 'aria-label', t('openDashboard'));
    appendIconToLink(dashboardLink, 'dashboard');
    cardFooter.append(streamLink, dashboardLink);
    card.append(cardEditor, cardFooter);

    cardSection = el('section', 'preset-panel dock-section');
    cardSection.setAttribute('aria-labelledby', 'presets-title');
    const panelHeading = el('div', 'panel-heading');
    const presetsTitle = el('h2');
    presetsTitle.id = 'presets-title';
    setText(presetsTitle, t('presets'));
    presetCount = el('span', 'preset-count');
    panelHeading.append(presetsTitle, presetCount);
    presetList = el('div', 'preset-list');
    presetHint = el('p', 'panel-hint');
    presetHint.innerHTML =
      'Добавьте Action в группу <code>STREAM INFO</code> и назовите его <code>PRESET | Название игры</code>.';
    cardSection.append(panelHeading, presetList, presetHint);

    root.append(card, cardSection);
    return root;
  }
  function appendIconToLink(link: HTMLAnchorElement, name: AppIcon): void {
    const iconBox = el('span', 'app-button__icon');
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.innerHTML = anyIcon(name);
    link.append(iconBox, el('span', 'app-button__label'));
  }

  function chipNode(label: string, removable: boolean): HTMLElement {
    let chip = chipNodes.get(label);
    if (!chip) {
      chip = el('span', 'chip-tag chip-tag--neutral');
      const chipLabel = el('span', 'chip-tag__label');
      const removeButton = el('button', 'chip-tag__remove');
      removeButton.type = 'button';
      removeButton.setAttribute('aria-label', `Удалить тег: ${label}`);
      const cross = el('span');
      cross.setAttribute('aria-hidden', 'true');
      setText(cross, '×');
      removeButton.append(cross);
      chip.append(chipLabel, removeButton);
      setText(chipLabel, label);
      removeButton.addEventListener('click', () => {
        const form = state.allForm;
        const index = form?.twitchTags.indexOf(label) ?? -1;
        if (index >= 0) controller.removeTag(index);
      });
      chipNodes.set(label, chip);
    }
    const chipButton = chip.querySelector('button') as HTMLButtonElement;
    if (removable) {
      chipButton.removeAttribute('disabled');
      chipButton.removeAttribute('aria-disabled');
    } else {
      chipButton.setAttribute('disabled', '');
      chipButton.setAttribute('aria-disabled', 'true');
    }
    return chip;
  }

  function presetNode(preset: PresetAction): HTMLElement {
    let cached = presetNodes.get(preset.id);
    if (!cached) {
      const node = el('button', 'app-button app-button--press app-button--secondary');
      node.type = 'button';
      const label = el('span', 'app-button__label');
      const iconBox = el('span', 'app-button__icon');
      iconBox.setAttribute('aria-hidden', 'true');
      iconBox.innerHTML = uiIcon('play');
      node.append(iconBox, label);
      node.addEventListener('click', () => {
        void controller.runPreset(preset.id, preset.name);
      });
      cached = { node, label, shown: '' };
      presetNodes.set(preset.id, cached);
    }
    if (cached.shown !== preset.label) {
      setText(cached.label, preset.label);
      cached.shown = preset.label;
    }
    setAttribute(cached.node, 'disabled', state.runningPresetId !== null);
    cached.node.className = composeClass('app-button app-button--press app-button--secondary', [
      state.runningPresetId === preset.id ? 'app-button--loading' : '',
    ]);
    return cached.node;
  }

  function syncContent(): void {
    const stream = state.stream;
    if (!stream) return;
    cardBusy = controller.busy();
    const available = controller.platformAvailable('twitch');
    const status = controller.cardStatus('twitch');
    const effect = state.cardEffects.twitch;
    const loading = controller.platformLoading('twitch');
    card.className = composeClass('platform-card dock-section', [
      status,
      state.cardErrors.twitch ? 'card-error' : '',
      effect ? `card-${effect}` : '',
    ]);
    setAttribute(card, 'aria-busy', loading);
    setText(cardAccountName, stream.twitch.accountName || t('accountNotConnected'));
    cardBadge.className = `live-status-badge live-status-badge--${status}`;
    const badgeLabel = t(
      status === 'live' ? 'live' : status === 'offline' ? 'offline' : 'notConnected',
    );
    if (cardBadgeText.data !== badgeLabel) cardBadgeText.data = badgeLabel;
    if (loading) {
      if (!cardLoadingNote.isConnected) card.insertBefore(cardLoadingNote, cardEditor);
      setText(cardLoadingNote, t('updating'));
    } else if (cardLoadingNote.isConnected) {
      cardLoadingNote.remove();
    }
    setAttribute(cardEditor, 'disabled', cardBusy);
    const form = state.allForm;
    patchField(subtitleField, form?.subtitle ?? '', cardBusy);
    const template = state.templateDraft.twitchTemplate;
    templateField.update(
      template,
      cardBusy,
      isTemplateValid(template) ? null : t('templateValidation'),
    );
    const final = controller.title();
    if (previewSpan.textContent !== finalPreview(template, form?.subtitle ?? '')) {
      previewSpan.replaceChildren(...previewNodes(template, form?.subtitle ?? ''));
    }
    setText(counterText, `${final.length} / 140`);
    if (final.length > 140 !== counterText.classList.contains('invalid')) {
      counterText.classList.toggle('invalid', final.length > 140);
    }
    setText(templateDirty, state.templatesDirty ? t('templatesUnsaved') : '');
    if (!available) {
      if (!accountWarning.isConnected) cardEditor.append(accountWarning);
      setText(accountWarning, t('accountNotConnected'));
    } else if (accountWarning.isConnected) {
      accountWarning.remove();
    }
    const tags = form?.twitchTags ?? [];
    const removable = !cardBusy;
    const chips = tags.map((tag) => chipNode(tag, removable));
    syncChildren(tagList, chips);
    patchField(tagField, form?.twitchTagDraft ?? '', cardBusy);
    if (form) {
      categorySearch.update({
        selected: form.twitchCategory,
        query: form.twitchCategoryQuery,
        results: state.twitchResults,
        disabled: cardBusy,
        loading: search.twitchSearching,
        error: search.searchError,
        partial: search.searchPartial,
        warnings: search.searchWarnings,
        hasMore: search.searchHasMore,
        limit: search.visibleCategories,
      });
    }
    const login = stream.twitch.login || '';
    patchLink(streamLink, login ? `https://www.twitch.tv/${encodeURIComponent(login)}` : null);
    patchLink(
      dashboardLink,
      login ? `https://dashboard.twitch.tv/u/${encodeURIComponent(login)}/stream-manager` : null,
    );
    setText(presetCount, String(state.presetActions.length));
    const presetActions = [...state.presetActions];
    for (const [id, cached] of [...presetNodes]) {
      if (!presetActions.some((preset) => preset.id === id)) {
        cached.node.remove();
        presetNodes.delete(id);
      }
    }
    for (const preset of presetActions) {
      setAttribute(presetNode(preset), 'data-preset-id', preset.id);
    }
    if (presetActions.length) {
      if (!presetList.isConnected) cardSection.insertBefore(presetList, presetHint);
      syncChildren(
        presetList,
        presetActions.map((preset) => presetNode(preset)),
      );
      presetHint.remove();
    } else {
      presetList.remove();
      if (!presetHint.isConnected) cardSection.append(presetHint);
    }
  }

  function finalPreview(template: string, subtitle: string): string {
    const value = subtitle.trim();
    const parts = template.split('%subtitle%');
    const separator = value || '%subtitle%';
    return parts.join(separator);
  }

  function previewNodes(template: string, subtitle: string): Node[] {
    const nodes: Node[] = [];
    const value = subtitle.trim();
    const parts = template.split('%subtitle%');
    for (const [index, part] of parts.entries()) {
      if (part) nodes.push(document.createTextNode(part));
      if (index < parts.length - 1) {
        const mark = document.createElement('mark');
        mark.className = value ? 'template-value' : 'template-token';
        setText(mark, value || '%subtitle%');
        nodes.push(mark);
      }
    }
    return nodes;
  }

  function patchLink(link: HTMLAnchorElement, href: string | null): void {
    if (href) {
      if (link.getAttribute('href') !== href) link.href = href;
      link.removeAttribute('aria-disabled');
    } else {
      link.removeAttribute('href');
      setAttribute(link, 'aria-disabled', 'true');
    }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }

  // Empty region --------------------------------------------------------------
  let emptyStatus: HTMLElement;
  let emptyError: HTMLElement;
  function buildEmpty(): HTMLElement {
    const root = el('main', 'empty-state');
    root.append(el('div', 'loader'));
    emptyStatus = el('p');
    emptyStatus.setAttribute('role', 'status');
    emptyError = el('p');
    root.append(emptyStatus, emptyError);
    return root;
  }
  function syncEmpty(): void {
    setText(
      emptyStatus,
      state.connection === 'disconnected' ? controller.connectionText() : t('loading'),
    );
    const message = state.connectionError;
    if (message) {
      if (!emptyError.isConnected) mainEl?.append(emptyError);
      setText(emptyError, message);
    } else emptyError.remove();
  }

  // Save panel ----------------------------------------------------------------
  function saveStatusText(): string {
    if (state.allSaving) return t('saving');
    if (state.allDirty)
      return t(state.allSaveResult === 'partial' ? 'changesPartlyApplied' : 'changesUnsaved');
    if (state.allSaveResult) return t('changesApplied');
    return t('changesReady');
  }

  function buildSavePanel(): HTMLElement {
    const root = el('section', 'save-panel');
    root.setAttribute('aria-label', t('editInfo'));
    saveStatus = el('p', 'save-status');
    saveStatus.setAttribute('role', 'status');
    saveStatus.setAttribute('aria-live', 'polite');
    const apply = appButton('primary', { label: t('applyChanges') });
    applyButton = apply.root;
    applyButton.addEventListener('click', () => {
      void controller.saveAll();
    });
    errorsHost = el('div', 'form-errors');
    errorsHost.setAttribute('role', 'status');
    root.append(saveStatus, applyButton, errorsHost);
    return root;
  }

  function syncSave(): void {
    if (!saveStatus || !applyButton || !errorsHost) return;
    setText(saveStatus, saveStatusText());
    saveStatus.className = composeClass('save-status', [
      state.allDirty ? 'is-dirty' : '',
      !state.allDirty && state.allSaveResult ? 'is-saved' : '',
    ]);
    const errors = controller.errors();
    applyButton.disabled =
      errors.length > 0 || controller.busy() || !controller.platformAvailable('twitch');
    applyButton.className = composeClass('app-button app-button--press app-button--primary', [
      state.allSaving ? 'app-button--loading' : '',
    ]);
    setAttribute(applyButton, 'aria-busy', state.allSaving);
    const joined = errors.join('\n');
    if (joined !== errorsJoined) {
      errorsJoined = joined;
      errorsHost.replaceChildren(
        ...errors.map((line) => {
          const node = el('p');
          setText(node, line);
          return node;
        }),
      );
    }
  }

  // Notices -------------------------------------------------------------------
  const noticeCache = new Map<string, { node: HTMLElement; signature: string }>();
  function noticeNode(notice: Notice): HTMLElement {
    const signature = `${notice.kind}|${notice.title}|${notice.lines.join('\n')}`;
    const cached = noticeCache.get(notice.id);
    if (cached) {
      if (cached.signature === signature) return cached.node;
      cached.node.remove();
      noticeCache.delete(notice.id);
    }
    const node = el('div', `notice notice--${notice.kind}`);
    node.setAttribute('role', notice.kind === 'error' ? 'alert' : 'status');
    const iconBox = el('span', 'notice__icon');
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.innerHTML = uiIcon(
      notice.kind === 'error'
        ? 'error'
        : notice.kind === 'warning'
          ? 'warning'
          : notice.kind === 'success'
            ? 'check'
            : 'info',
    );
    const body = el('div', 'notice__body');
    const titleNode = el('strong', 'notice__title');
    setText(titleNode, notice.title);
    const description = el('div', 'notice__description');
    for (const line of notice.lines) {
      const lineNode = el('span', 'notice-line');
      setText(lineNode, line);
      description.append(lineNode);
    }
    body.append(titleNode, description);
    const dismiss = el('button', 'notice__dismiss');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', t('closeNotice'));
    const cross = el('span');
    cross.setAttribute('aria-hidden', 'true');
    setText(cross, '×');
    dismiss.append(cross);
    dismiss.addEventListener('click', () => controller.closeNotice(notice.id));
    node.append(iconBox, body, dismiss);
    noticeCache.set(notice.id, { node, signature });
    return node;
  }
  function syncNotices(container: HTMLDivElement): void {
    const wanted = new Set(state.notices.map((notice) => notice.id));
    for (const [id, cached] of [...noticeCache]) {
      if (!wanted.has(id)) {
        cached.node.remove();
        noticeCache.delete(id);
      }
    }
    syncChildren(
      container,
      state.notices.map((notice) => noticeNode(notice)),
    );
  }

  // Settings modal -------------------------------------------------------------
  function buildModal(): void {
    // Фокус уже в открывателе, когда предыдущий бэкдроп закрывается; не
    // считать его активный элемент «настоящим» открывателем.
    const candidate =
      document.activeElement instanceof HTMLElement &&
      !document.activeElement.closest('.modal-backdrop')
        ? document.activeElement
        : null;
    returnFocus = candidate;
    const backdrop = el('div', 'modal-backdrop');
    const dialog = el('section', 'modal settings-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'settings-title');

    const modalHeader = el('header', 'modal-header');
    const titleBox = el('div');
    const eyebrow = el('span', 'eyebrow');
    setText(eyebrow, t('connection'));
    const modalTitle = el('h2');
    modalTitle.id = 'settings-title';
    setText(modalTitle, t('settings'));
    titleBox.append(eyebrow, modalTitle);
    const close = appButton('icon', { ariaLabel: t('close'), icon: 'close' });
    close.root.addEventListener('click', () => controller.closeSettings());
    modalHeader.append(titleBox, close.root);

    const modalBody = el('div', 'modal-body');
    const section = el('section', 'settings-section');
    const sectionTitle = el('h3');
    setText(sectionTitle, t('connectionToStreamerbot'));
    const hostField = buildField({ id: 'settings-host-input', label: 'Хост' });
    const portField = buildField({
      id: 'settings-port-input',
      label: 'Порт',
      type: 'number',
      min: 1,
      max: 65535,
    });
    const endpointField = buildField({ id: 'settings-endpoint-input', label: 'Endpoint' });
    const passwordField = buildField({
      id: 'settings-password-input',
      label: t('password'),
      type: 'password',
      autocomplete: 'current-password',
    });
    hostField.input.addEventListener('input', () => {
      state.settingsDraft.host = hostField.input.value;
    });
    portField.input.addEventListener('input', () => {
      state.settingsDraft.port = Number(portField.input.value);
    });
    endpointField.input.addEventListener('input', () => {
      state.settingsDraft.endpoint = endpointField.input.value;
    });
    passwordField.input.addEventListener('input', () => {
      state.settingsDraft.password = passwordField.input.value;
    });
    const grid = el('div', 'settings-grid');
    grid.append(hostField.root, portField.root);
    const remember = el('input');
    remember.type = 'checkbox';
    remember.checked = state.settingsDraft.rememberPassword;
    remember.addEventListener('change', () => {
      state.settingsDraft.rememberPassword = remember.checked;
    });
    const checkRow = el('label', 'check-row');
    checkRow.append(remember, document.createTextNode(t('rememberPassword')));
    section.append(sectionTitle, grid, endpointField.root, passwordField.root, checkRow);
    modalNoticesHost = el('div', 'notices');
    modalBody.append(section, modalNoticesHost);

    const modalFooter = el('footer', 'modal-footer');
    const save = appButton('primary', { label: t('saveConnection') });
    save.root.addEventListener('click', () => controller.saveConnection());
    modalFooter.append(save.root);

    dialog.append(modalHeader, modalBody, modalFooter);
    backdrop.append(dialog);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) controller.closeSettings();
    });
    backdrop.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        controller.closeSettings();
        return;
      }
      if (event.key !== 'Tab') return;
      const fields = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      );
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? fields.indexOf(active) : -1;
      if (
        fields.length &&
        (index < 0 ||
          (!event.shiftKey && index === fields.length - 1) ||
          (event.shiftKey && index === 0))
      ) {
        event.preventDefault();
        fields[event.shiftKey ? fields.length - 1 : 0]?.focus();
      }
    });
    backdrop.append(dialog);
    modalBackdrop = backdrop;
    modalKeys = {
      host: hostField,
      port: portField,
      endpoint: endpointField,
      password: passwordField,
      remember,
    };
    // Инертная оболочка не должна накрывать сам модал: монтируем backdrop
    // рядом с shell, а не внутри.
    host.append(backdrop);
    dialog.querySelector<HTMLElement>('button, input, textarea')?.focus();
  }

  function retireModal(): void {
    const backdrop = modalBackdrop;
    modalBackdrop = null;
    modalKeys = null;
    modalNoticesHost = null;
    if (!backdrop) return;
    if (modalExitTimer !== null) {
      window.clearTimeout(modalExitTimer);
      modalExitTimer = null;
    }
    const opener = returnFocus;
    returnFocus = null;
    // Возвращаем фокус сразу: если элемент диалога получит detach с фокусом,
    // браузер отправит его в body, и повторное открытие сохранит настоящий
    // открыватель.
    opener?.focus();
    const finish = (): void => {
      backdrop.remove();
    };
    backdrop.setAttribute('inert', '');
    backdrop.setAttribute('aria-hidden', 'true');
    const raw = window.getComputedStyle(backdrop).getPropertyValue('--motion-exit');
    const exit = Number.parseFloat(raw);
    if (Number.isFinite(exit) && exit > 0) {
      modalExitTimer = window.setTimeout(() => {
        modalExitTimer = null;
        finish();
      }, exit + 1);
    } else {
      finish();
    }
  }

  function syncModalFields(): void {
    const keys = modalKeys;
    if (!keys) return;
    const draft = state.settingsDraft;
    patchFocusableField(keys.host, draft.host);
    patchFocusableField(keys.port, String(draft.port));
    patchFocusableField(keys.endpoint, draft.endpoint);
    patchFocusableField(keys.password, draft.password);
    if (keys.remember.checked !== draft.rememberPassword)
      keys.remember.checked = draft.rememberPassword;
  }
  function patchFocusableField(field: Field, value: string): void {
    if (field.input.value === value) return;
    if (document.activeElement === field.input) return;
    field.input.value = value;
  }

  // Render pass -----------------------------------------------------------------
  function render(): void {
    setAttribute(statusDot, 'data-status', state.connection);
    setText(statusText, controller.connectionText());
    setAttribute(refresh.root, 'disabled', state.connection !== 'connected');

    const kind: Exclude<MainKind, null> = state.authNeeded
      ? 'auth'
      : SETUP_STATUSES.includes(state.actionStatus)
        ? 'setup'
        : state.stream
          ? 'content'
          : 'empty';
    if (kind === 'auth') switchRegion('auth', buildAuth, syncAuth);
    else if (kind === 'setup') switchRegion('setup', buildSetup, syncSetup);
    else if (kind === 'content') switchRegion('content', buildContent, syncContent);
    else switchRegion('empty', buildEmpty, syncEmpty);

    const wantSave = state.stream !== null && !SETUP_STATUSES.includes(state.actionStatus);
    if (wantSave && !savePanel) {
      savePanel = buildSavePanel();
      shell.append(savePanel);
    } else if (!wantSave && savePanel) {
      savePanel.remove();
      savePanel = null;
      saveStatus = null;
      applyButton = null;
      errorsHost = null;
      errorsJoined = '';
    }
    if (savePanel) syncSave();

    setText(versionText, `Stream Info ${controller.version}`);
    setText(
      updatedText,
      `${t('updated')} ${
        state.lastUpdated?.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }) ?? '—'
      }`,
    );
    if (state.modal === null) syncNotices(noticesHost);
    for (const child of [...noticesHost.children]) {
      if (state.modal !== null) child.remove();
    }

    const wantModal = state.modal === 'settings';
    shell.toggleAttribute('inert', wantModal);
    if (wantModal && !modalBackdrop) {
      for (const child of [...noticesHost.children]) child.remove();
      buildModal();
    } else if (!wantModal && modalBackdrop) retireModal();
    if (modalBackdrop) {
      syncModalFields();
      if (modalNoticesHost) syncNotices(modalNoticesHost);
    }
  }

  const renderListener = (): void => render();
  const unsubscribe = subscribe(renderListener);
  render();
  controller.start();
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      if (modalExitTimer !== null) {
        window.clearTimeout(modalExitTimer);
        modalExitTimer = null;
      }
      controller.dispose();
      host.replaceChildren();
    },
  };
}
