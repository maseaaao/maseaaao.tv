/**
 * Выкладка Dock без фреймворка: статические узлы строятся один раз, ветки
 * (auth/setup/content/empty/save-panel/modal) пересоздаются только при смене
 * ветки, списки — keyed-синхронизацией, чтобы сохранять фокус, IME-состав,
 * выделение и скролл. Эта разметка — единственный источник DOM.
 */
import STREAMERBOT_IMPORT from '../../../dist/.cache/stream-info/streamerbot-import.txt?raw';
import { rankCategories } from './category-search';
import { createStreamInfo, type Notice, type PresetAction } from './controller';
import { type AppIcon, anyIcon, uiIcon } from './icons';
import { t } from './messages';
import { subscribe } from './reactive';
import {
  GAME_TOKEN,
  isTemplateValid,
  splitTemplate,
  TEMPLATE_TOKEN,
  templateHasToken,
} from './templates';
import type { AllForm, Platform, TwitchCategory } from './types';
import { YOUTUBE_CATEGORIES } from './youtube-categories';

export interface Dock {
  dispose: () => void;
}

const SETUP_STATUSES: readonly string[] = ['missing', 'disabled', 'outdated'];

/*
 * Асинхронные операции интерфейса обрабатывают собственные сбои внутри;
 * здесь лишь подавляем необработанное отклонение — как и раньше делал void,
 * только без запрещённого оператора.
 */
function background(operation: Promise<void>): void {
  operation.catch(() => undefined);
}

function badgeMessage(status: string): 'live' | 'offline' | 'notConnected' {
  if (status === 'live') {
    return 'live';
  }
  if (status === 'offline') {
    return 'offline';
  }
  return 'notConnected';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

function setText(node: Element, text: string): void {
  if (node.textContent !== text) {
    node.textContent = text;
  }
}

function setAttribute(node: Element, name: string, value: string | boolean | null): void {
  if (value === null || value === false) {
    node.removeAttribute(name);
  } else {
    const text = typeof value === 'boolean' ? 'true' : value;
    if (node.getAttribute(name) !== text) {
      node.setAttribute(name, text);
    }
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
  label: HTMLSpanElement;
  root: HTMLButtonElement;
}

function appButton(
  variant: 'primary' | 'secondary' | 'icon',
  content: { label?: string; icon?: AppIcon; ariaLabel?: string },
): AppButton {
  const root = el('button', `app-button app-button--press app-button--${variant}`);
  root.type = 'button';
  if (content.ariaLabel) {
    root.setAttribute('aria-label', content.ariaLabel);
  }
  const label = el('span', 'app-button__label');
  if (content.icon) {
    const box = el('span', 'app-button__icon');
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = anyIcon(content.icon);
    root.append(box, label);
  } else {
    root.append(label);
  }
  if (content.label) {
    setText(label, content.label);
  }
  return { label, root };
}

interface Field {
  input: HTMLInputElement | HTMLTextAreaElement;
  root: HTMLDivElement;
}

interface FieldSpec {
  autocomplete?: string;
  id: string;
  label: string;
  max?: number;
  min?: number;
  multiline?: boolean;
  placeholder?: string;
  readonly?: boolean;
  type?: 'text' | 'password' | 'number';
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
    if (spec.readonly) {
      area.readOnly = true;
    }
  } else {
    const input = control as HTMLInputElement;
    input.type = spec.type ?? 'text';
    if (typeof spec.min === 'number') {
      input.min = String(spec.min);
    }
    if (typeof spec.max === 'number') {
      input.max = String(spec.max);
    }
    if (spec.autocomplete) {
      input.setAttribute('autocomplete', spec.autocomplete);
    }
    if (spec.readonly) {
      input.readOnly = true;
    }
  }
  if (spec.placeholder) {
    control.placeholder = spec.placeholder;
  }
  root.append(label, control);
  return { input: control, root };
}

function patchField(field: Field, value: string, disabled: boolean): void {
  if (field.input.value !== value) {
    field.input.value = value;
  }
  setAttribute(field.input, 'disabled', disabled);
}

function composeClass(base: string, extra: Array<string | false | null | undefined>): string {
  return [base, ...extra.filter(Boolean)].join(' ');
}

/** Keyed-синхронизатор: убирает лишнее и двигает узлы только при смене порядка. */
function syncChildren(container: HTMLElement, next: readonly Element[]): void {
  const wanted = new Set<Element>(next);
  for (const child of [...container.children]) {
    if (!wanted.has(child)) {
      child.remove();
    }
  }
  const current = [...container.children];
  if (next.length === current.length && next.every((node, index) => current[index] === node)) {
    return;
  }
  let cursor: Element | null = container.firstElementChild;
  for (const node of next) {
    if (cursor === node) {
      cursor = cursor.nextElementSibling;
      continue;
    }
    if (cursor) {
      container.insertBefore(node, cursor);
    } else {
      container.append(node);
    }
  }
}

interface Cover {
  root: HTMLSpanElement;
  update: (src: string) => void;
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
      if (src === current) {
        return;
      }
      current = src;
      failed = false;
      render(src);
    },
  };
}

interface SearchInput {
  disabled: boolean;
  error: string | null;
  hasMore: boolean;
  limit: number;
  loading: boolean;
  partial: boolean;
  query: string;
  results: TwitchCategory[];
  selected: TwitchCategory | null;
  warnings: string[];
}

interface SearchHooks {
  onChoose: (id: string) => void;
  onCompositionStart: () => void;
  onMore: () => void;
  onQuery: (value: string, composing: boolean) => void;
  onRetry: () => void;
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
  update: (values: SearchInput) => void;
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
    if (!valuesSnapshot.loading) {
      hooks.onMore();
    }
  });

  let valuesSnapshot: SearchInput = {
    disabled: false,
    error: null,
    hasMore: false,
    limit: 20,
    loading: false,
    partial: false,
    query: '',
    results: [],
    selected: null,
    warnings: [],
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
    if (activeId && !visibleList.some((option) => option.id === activeId)) {
      activeId = null;
    }
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
  function moveActiveCategory(key: KeyboardEvent): void {
    key.preventDefault();
    const visibleList = visible();
    const index = visibleList.findIndex((option) => option.id === activeId);
    const direction = key.key === 'ArrowDown' ? 1 : -1;
    let next: number;
    if (index < 0) {
      if (direction === 1) {
        next = 0;
      } else {
        next = visibleList.length - 1;
      }
    } else {
      next = (index + direction + visibleList.length) % visibleList.length;
    }
    activeId = visibleList[next]?.id ?? null;
    syncOptions(visibleList);
    input.focus();
    if (activeId) {
      document.getElementById(optionId(activeId))?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  input.addEventListener('keydown', (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.isComposing || composing || valuesSnapshot.disabled) {
      return;
    }
    if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
      moveActiveCategory(key);
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

  function syncSelectedCategory(values: SearchInput): void {
    if (values.selected) {
      if (selectedShown === null) {
        root.insertBefore(selectedBox, label);
      }
      selectedShown = values.selected.id;
      selectedCover.update(values.selected.imageUrl);
      setText(selectedName, values.selected.name);
    } else if (selectedShown !== null) {
      selectedBox.remove();
      selectedShown = null;
    }
  }

  function syncCategoryOptions(visibleList: TwitchCategory[]): void {
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
          cached = { cover, name, node };
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
  }

  function syncSearchWarnings(values: SearchInput): void {
    if (!values.partial) {
      if (warningHead.isConnected) {
        warningHead.remove();
        warningLines.remove();
      }
      return;
    }
    {
      if (!warningHead.isConnected) {
        warning.append(warningHead, warningLines);
      }
      setText(warningHead, t('categoryPartial'));
      const wanted = new Set(values.warnings);
      for (const node of [...warningLines.children]) {
        if (!wanted.has(node.textContent ?? '')) {
          node.remove();
        }
      }
      for (const line of values.warnings) {
        const existing = [...warningLines.children].some(
          (nodeLocal) => nodeLocal.textContent === line,
        );
        if (existing) {
          continue;
        }
        const node = el('p');
        setText(node, line);
        warningLines.append(node);
      }
    }
  }

  function syncRetryAction(values: SearchInput): void {
    if (values.error) {
      if (!retry.root.isConnected) {
        actions.append(retry.root);
      }
    } else if (retry.root.isConnected) {
      retry.root.remove();
    }
  }

  function syncMoreAction(values: SearchInput, moreNow: boolean): void {
    if (moreNow) {
      if (!more.root.isConnected) {
        actions.append(more.root);
      }
      const wantedAria = values.loading ? 'true' : 'false';
      if (more.root.getAttribute('aria-disabled') !== wantedAria) {
        more.root.setAttribute('aria-disabled', wantedAria);
      }
    } else if (more.root.isConnected) {
      more.root.remove();
    }
  }

  function syncSearchActions(values: SearchInput): void {
    const moreNow = moreAvailable();
    // Активный элемент фиксируем до удаления: после remove браузер сам
    // может вернуть фокус в body.
    const actionFocus =
      document.activeElement === more.root || document.activeElement === retry.root
        ? (document.activeElement as HTMLElement)
        : null;
    syncRetryAction(values);
    syncMoreAction(values, moreNow);
    // «Повторить поиск» стоит перед «Показать ещё», когда оба присутствуют.
    if (
      retry.root.isConnected &&
      more.root.isConnected &&
      actions.lastElementChild === retry.root
    ) {
      actions.insertBefore(retry.root, more.root);
    }
    if (actionFocus && !actionFocus.isConnected) {
      refocusInputAfterRender();
    }
  }

  function syncSearchStatus(values: SearchInput, visibleList: TwitchCategory[]): void {
    let info: { alert: boolean; text: string };
    if (values.loading) {
      info = { alert: false, text: t('categorySearching') };
    } else if (values.error) {
      info = { alert: true, text: values.error };
    } else if (visibleList.length || moreAvailable()) {
      info = { alert: false, text: t('categoryResultCount', { count: visibleList.length }) };
    } else {
      info = { alert: false, text: t('nothingFound') };
    }
    setAttribute(status, 'role', info.alert ? 'alert' : 'status');
    setAttribute(status, 'aria-live', 'polite');
    setText(status, info.text);
  }

  return {
    input,
    root,
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
      syncSelectedCategory(values);
      const visibleList = visible();
      patchField({ input, root }, values.query, values.disabled);
      input.placeholder = values.selected ? t('categorySearchOther') : t('categorySearch');
      setAttribute(input, 'aria-expanded', nowExpanded);
      syncCategoryOptions(visibleList);
      syncOptions(visibleList);
      syncSearchStatus(values, visibleList);
      syncSearchWarnings(values);
      syncSearchActions(values);
    },
  };
}

interface TemplateField {
  root: HTMLDivElement;
  update: (template: string, disabled: boolean, error: string | null) => void;
}

function buildTemplateField(
  platform: 'twitch' | 'youtube',
  onInput: (value: string) => void,
): TemplateField {
  const inputId = platform === 'twitch' ? 'template-field-input' : 'template-field-input-youtube';
  const root = el('div', 'template-input');
  const label = el('label');
  label.setAttribute('for', inputId);
  setText(label, t(platform === 'twitch' ? 'twitchTemplate' : 'youtubeTemplate'));
  const editor = el('div', 'template-input__editor');
  const highlight = el('div', 'template-input__highlight');
  highlight.setAttribute('aria-hidden', 'true');
  const input = el('input');
  input.name = 'template';
  input.id = inputId;
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
  errorLine.id = platform === 'twitch' ? 'template-field-error' : 'template-field-error-youtube';
  editor.append(highlight, input);
  root.append(label, editor);

  function syncEditorClasses(disabled: boolean, error: string | null): void {
    editor.className = composeClass('template-input__editor', [
      error ? 'is-invalid' : '',
      disabled ? 'is-disabled' : '',
    ]);
  }

  function syncHighlight(template: string): void {
    const parts = splitTemplate(template);
    const next: Node[] = [];
    for (const part of parts) {
      if (!part) {
        continue;
      }
      if (part === TEMPLATE_TOKEN || part === GAME_TOKEN) {
        const mark = el('mark');
        if (part === GAME_TOKEN) {
          mark.className = 'template-game-token';
        }
        setText(mark, part);
        next.push(mark);
      } else {
        next.push(document.createTextNode(part));
      }
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
      if (input.value !== template) {
        input.value = template;
      }
      // Без токена название некуда подставлять: подпись сразу показывает,
      // какой токен ожидается, а поле получает состояние ошибки.
      setText(
        label,
        templateHasToken(template)
          ? t(platform === 'twitch' ? 'twitchTemplate' : 'youtubeTemplate')
          : t(platform === 'twitch' ? 'twitchTemplateToken' : 'youtubeTemplateToken'),
      );
      syncHighlight(template);
      setAttribute(input, 'disabled', disabled);
      syncEditorClasses(disabled, errorText);
      if (errorText) {
        if (!errorLine.isConnected) {
          root.append(errorLine);
        }
        setText(errorLine, errorText);
        setAttribute(input, 'aria-invalid', 'true');
        setAttribute(
          input,
          'aria-describedby',
          platform === 'twitch' ? 'template-field-error' : 'template-field-error-youtube',
        );
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
  const { state } = controller;
  const { settings } = controller;
  const { search } = controller;
  let disposed = false;

  host.replaceChildren();
  const shell = el('div', 'dock-shell');
  const scrollEl = el('div', 'dock-scroll');
  host.append(shell);

  // Header -----------------------------------------------------------------
  // Подключение к Streamer.bot — служебное состояние, поэтому индикатор живёт
  // в нижней закреплённой панели рядом с «Данные загружены». В состояниях без
  // этой панели (авторизация, установка Action) он возвращается в шапку.
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
    background(controller.refreshState());
  });
  settingsButton.root.addEventListener('click', () => {
    controller.openSettings();
  });
  // Ссылки на стрим и дашборд — такие же иконочные действия, как обновление и
  // настройки, поэтому живут в шапке, а не в подвале карточки.
  const streamLink = iconLink(t('openStream'), 'external');
  const dashboardLink = iconLink(t('openDashboard'), 'dashboard');
  const headerActions = el('div', 'header-actions');
  headerActions.append(streamLink, dashboardLink, refresh.root, settingsButton.root);
  const header = el('header', 'dock-header');
  header.append(titleHolder, headerActions);

  // Уведомления — липкий слой внизу области прокрутки: он заметен при любой
  // прокрутке и не закрывает панель «Применить изменения». Версия и время
  // обновления живут в модалке «Настройки», поэтому отдельного футера нет.
  const noticesHost = el('div', 'notices notices--dock');
  scrollEl.append(header, noticesHost);
  shell.append(scrollEl);

  // Region switch -----------------------------------------------------------
  type MainKind = 'auth' | 'setup' | 'content' | 'empty' | null;
  let mainKind: MainKind = null;
  let mainEl: HTMLElement | null = null;
  let savePanel: HTMLElement | null = null;
  let saveMeta: HTMLElement | null = null;
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
  let modalMeta: HTMLParagraphElement | null = null;
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
      scrollEl.insertBefore(mainEl, noticesHost);
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
      autocomplete: 'current-password',
      id: 'auth-password-input',
      label: t('password'),
      type: 'password',
    });
    authPassword.input.addEventListener('input', () => {
      settings.password = authPassword.input.value;
    });
    const connect = appButton('primary', { label: t('connect') });
    connect.root.addEventListener('click', () => {
      background(controller.connect());
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
    const copy = appButton('primary', { icon: 'copy', label: t('copyImport') });
    const toggle = appButton('secondary', { label: t('showImport') });
    const check = appButton('secondary', { label: t('checkAgain') });
    copy.root.addEventListener('click', () => {
      background(copyImport());
    });
    toggle.root.addEventListener('click', () => {
      state.showImport = !state.showImport;
    });
    check.root.addEventListener('click', () => {
      background(controller.verifyAction());
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
    if (disableCase) {
      setText(setupEnableText, t('importEnable'));
    }
    setupSteps.hidden = disableCase;
    setText(setupCopyLabel, state.importCopied ? t('copied') : t('copyImport'));
    setText(setupToggleLabel, state.showImport ? t('hideImport') : t('showImport'));
    if (state.showImport) {
      if (!setupImportField.root.isConnected) {
        setupRoot.append(setupImportField.root);
      }
      patchField(setupImportField, STREAMERBOT_IMPORT, false);
    } else {
      setupImportField.root.remove();
    }
  }

  async function copyImport(): Promise<void> {
    let copied = false;
    try {
      await navigator.clipboard.writeText(STREAMERBOT_IMPORT);
      copied = true;
    } catch {
      if (disposed) {
        return;
      }
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
    if (disposed) {
      return;
    }
    state.importCopied = copied;
    if (!copied) {
      state.notices.unshift({
        id: crypto.randomUUID(),
        kind: 'error',
        lines: ['Покажите строку и скопируйте её вручную.'],
        title: 'Не удалось скопировать строку',
      });
    }
  }

  // Content region ----------------------------------------------------------
  let subtitleField: Field;
  let subtitleError: HTMLElement;
  let templateDirty: HTMLElement;
  let sharedTagList: HTMLElement;
  let sharedTagField: Field;
  let sharedAddTag: HTMLButtonElement;
  let sharedTagError: HTMLElement;
  let twitchEditor: PlatformEditor;
  let youtubeEditor: PlatformEditor;
  let presetsSection: HTMLElement;
  let presetList: HTMLElement;
  let presetHint: HTMLElement;
  let presetCount: HTMLElement;
  let cardBusy = false;
  const presetNodes = new Map<
    string,
    { node: HTMLButtonElement; label: HTMLSpanElement; shown: string }
  >();
  const chipNodes = new Map<string, HTMLElement>();

  interface PlatformEditor {
    accountName: HTMLElement;
    badge: HTMLSpanElement;
    badgeText: Text;
    categoryError: HTMLElement;
    categorySearch: ReturnType<typeof buildCategorySearch> | null;
    categorySelect: HTMLSelectElement | null;
    counter: HTMLElement;
    editor: HTMLFieldSetElement;
    fullMode: HTMLButtonElement;
    fullTitle: Field;
    loadingNote: HTMLElement;
    platform: Platform;
    preview: HTMLElement;
    root: HTMLElement;
    subtitleMode: HTMLButtonElement;
    template: TemplateField;
    titleError: HTMLElement;
    warning: HTMLElement;
  }

  function platformName(platform: Platform): string {
    return platform === 'twitch' ? 'Twitch' : 'YouTube';
  }

  function formTitle(form: AllForm, platform: Platform): string {
    return platform === 'twitch' ? form.twitchTitle : form.youtubeTitle;
  }

  function formTitleMode(form: AllForm, platform: Platform): 'subtitle' | 'full' {
    return platform === 'twitch' ? form.twitchTitleMode : form.youtubeTitleMode;
  }

  function buildYouTubeCategorySelect(): {
    root: HTMLDivElement;
    select: HTMLSelectElement;
  } {
    const root = el('div', 'field-input');
    const label = el('label', 'field-input__label');
    label.setAttribute('for', 'youtube-category-select');
    setText(label, t('category'));
    const select = el('select', 'field-input__control');
    select.id = 'youtube-category-select';
    const placeholder = el('option');
    placeholder.value = '';
    placeholder.disabled = true;
    setText(placeholder, t('categoryPlaceholder'));
    select.append(placeholder);
    for (const category of YOUTUBE_CATEGORIES) {
      const option = el('option');
      option.value = category.name;
      setText(option, category.name);
      select.append(option);
    }
    select.addEventListener('change', () => controller.setYouTubeCategory(select.value));
    root.append(label, select);
    return { root, select };
  }

  function buildPlatformEditor(platform: Platform): PlatformEditor {
    const root = el('section', 'platform-card dock-section');
    root.dataset.platform = platform;
    root.setAttribute('aria-label', platformName(platform));

    const heading = el('header', 'card-heading');
    const accountHeading = el('div', 'account-heading');
    accountHeading.append(icon(platform, 'account-icon'));
    const accountTexts = el('div');
    const accountName = el('h2', 'account-name');
    accountTexts.append(accountName);
    accountHeading.append(accountTexts);
    const badge = el('span', 'live-status-badge');
    badge.setAttribute('role', 'status');
    const badgeDot = el('span', 'live-status-badge__dot');
    badgeDot.setAttribute('aria-hidden', 'true');
    const badgeText = document.createTextNode('');
    badge.append(badgeDot, badgeText);
    heading.append(accountHeading, badge);
    root.append(heading);

    const loadingNote = el('p', 'field-note');
    loadingNote.setAttribute('role', 'status');

    const editor = el('fieldset', 'inline-editor');
    const legend = el('legend', 'sr-only');
    setText(legend, `${t('editInfo')} ${platformName(platform)}`);
    editor.append(legend);

    const template = buildTemplateField(platform, (value) =>
      controller.setTemplate(platform, value),
    );

    const modeRow = el('div', 'title-mode');
    modeRow.setAttribute('role', 'group');
    setAttribute(modeRow, 'aria-label', t('title'));
    const subtitleMode = el('button', 'title-mode__button');
    subtitleMode.type = 'button';
    setText(subtitleMode, t('byTemplate'));
    const fullMode = el('button', 'title-mode__button');
    fullMode.type = 'button';
    setText(fullMode, t('fullTitle'));
    subtitleMode.addEventListener('click', () => controller.setTitleMode(platform, 'subtitle'));
    fullMode.addEventListener('click', () => controller.setTitleMode(platform, 'full'));
    modeRow.append(subtitleMode, fullMode);

    const fullTitle = buildField({
      id: `${platform}-full-title-input`,
      label: t('fullTitle'),
    });
    fullTitle.input.name = 'title';
    fullTitle.input.autocomplete = 'off';
    fullTitle.input.addEventListener('input', () => {
      controller.setTitle(platform, fullTitle.input.value);
    });

    const preview = el('div', 'title-preview');
    const previewNote = el('span', 'field-note');
    setText(previewNote, t('finalTitle'));
    const previewHolder = el('strong');
    const previewText = el('span', 'template-preview-text');
    previewHolder.append(previewText);
    const counter = el('span', 'counter');
    const titlePrefix = platform === 'twitch' ? '' : 'youtube-';
    counter.id = `${titlePrefix}title-counter`;
    const titleError = el('p', 'field-error');
    titleError.id = `${titlePrefix}title-error`;
    fullTitle.input.setAttribute(
      'aria-describedby',
      `${titlePrefix}title-counter ${titlePrefix}title-error`,
    );
    fullTitle.root.append(titleError);
    preview.append(previewNote, previewHolder, counter);

    editor.append(preview, modeRow, fullTitle.root);

    let categorySearch: ReturnType<typeof buildCategorySearch> | null = null;
    let categorySelect: HTMLSelectElement | null = null;
    if (platform === 'twitch') {
      const searchHolder = buildCategorySearch('twitch-category', searchHooks);
      categorySearch = searchHolder;
      editor.append(searchHolder.root);
    } else {
      const category = buildYouTubeCategorySelect();
      categorySelect = category.select;
      editor.append(category.root);
    }
    const categoryError = el('p', 'field-error');
    editor.append(categoryError);

    const warning = el('p', 'account-warning');
    root.append(loadingNote, template.root, editor, warning);

    return {
      accountName,
      badge,
      badgeText,
      categoryError,
      categorySearch,
      categorySelect,
      counter,
      editor,
      fullMode,
      fullTitle,
      loadingNote,
      platform,
      preview: previewText,
      root,
      subtitleMode,
      template,
      titleError,
      warning,
    };
  }

  const searchHooks: SearchHooks = {
    onChoose: (id) => controller.chooseCategory(id),
    onCompositionStart: () => controller.resetCategorySearch(),
    onMore: () => controller.moreCategories(),
    onQuery: (value, composing) => controller.setCategoryQuery(value, composing),
    onRetry: () => controller.retrySearch(),
  };

  function buildContent(): HTMLElement {
    const root = el('main', 'content');

    const shared = el('section', 'shared-title dock-section');
    const sharedTitle = el('h2');
    setText(sharedTitle, 'Общее название');
    subtitleField = buildField({
      id: 'subtitle-input',
      label: t('title'),
      placeholder: t('subtitleExample'),
    });
    subtitleField.input.name = 'title';
    subtitleField.input.autocomplete = 'off';
    subtitleField.input.addEventListener('input', () => {
      controller.setSubtitle(subtitleField.input.value);
    });
    subtitleError = el('p', 'field-error');
    subtitleError.id = 'subtitle-error';
    subtitleField.root.append(subtitleError);
    subtitleField.input.setAttribute('aria-describedby', 'subtitle-error');
    templateDirty = el('p', 'template-dirty');
    templateDirty.setAttribute('role', 'status');

    const tagsTitle = el('h3');
    setText(tagsTitle, 'Теги');
    const tagEditor = el('div', 'tag-editor shared-tags');
    sharedTagField = buildField({
      id: 'tag-draft-input',
      label: t('addTag'),
      placeholder: 'Например, Русский',
    });
    sharedTagField.input.addEventListener('input', () => {
      controller.setTagDraft(sharedTagField.input.value);
    });
    sharedTagField.input.addEventListener('keydown', (event: Event) => {
      const key = event as KeyboardEvent;
      const form = state.allForm;
      if (key.isComposing || cardBusy || !form) {
        return;
      }
      if (key.key === 'Enter' || key.key === ',') {
        key.preventDefault();
        controller.addTag();
      } else if (key.key === 'Backspace' && !form.tagDraft && form.tags.length) {
        key.preventDefault();
        controller.removeTag(form.tags.length - 1);
      }
    });
    sharedTagList = el('div', 'tag-list');
    sharedTagList.setAttribute('role', 'group');
    setAttribute(sharedTagList, 'aria-label', 'Выбранные теги');
    const tagEntry = el('div', 'tag-entry');
    const addTagButton = appButton('secondary', { ariaLabel: t('addTag'), label: 'Добавить' });
    sharedAddTag = addTagButton.root;
    sharedAddTag.addEventListener('click', () => {
      controller.addTag();
      sharedTagField.input.focus();
    });
    tagEntry.append(sharedTagField.root, sharedAddTag);
    const tagHint = el('p', 'field-note');
    setText(tagHint, 'Одинаковые для Twitch и YouTube: до 10 тегов, до 25 символов, без пробелов.');
    sharedTagError = el('p', 'field-error');
    sharedTagError.id = 'tag-error';
    sharedTagField.input.setAttribute('aria-describedby', 'tag-error');
    tagEditor.append(tagEntry, tagHint, sharedTagError, sharedTagList);
    shared.append(sharedTitle, subtitleField.root, templateDirty, tagsTitle, tagEditor);

    twitchEditor = buildPlatformEditor('twitch');
    youtubeEditor = buildPlatformEditor('youtube');

    presetsSection = el('details', 'preset-panel dock-section');
    (presetsSection as HTMLDetailsElement).open = true;
    const summary = el('summary', 'panel-heading preset-summary');
    const presetsTitle = el('h2');
    presetsTitle.id = 'presets-title';
    setText(presetsTitle, t('presets'));
    presetCount = el('span', 'preset-count');
    summary.append(presetsTitle, presetCount, icon('chevronDown', 'preset-chevron'));
    presetList = el('div', 'preset-list');
    presetHint = el('p', 'panel-hint');
    presetHint.innerHTML =
      'Добавьте Action в группу <code>STREAM INFO</code> и назовите его <code>PRESET | Название игры</code>.';
    presetsSection.append(summary, presetList, presetHint);

    root.append(shared, twitchEditor.root, youtubeEditor.root, presetsSection);
    return root;
  }

  function appendIconToLink(link: HTMLAnchorElement, name: AppIcon): void {
    const iconBox = el('span', 'app-button__icon');
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.innerHTML = anyIcon(name);
    link.append(iconBox, el('span', 'app-button__label'));
  }

  function iconLink(label: string, name: AppIcon): HTMLAnchorElement {
    const link = el('a');
    link.className = 'app-button app-button--press app-button--icon';
    setAttribute(link, 'aria-label', label);
    appendIconToLink(link, name);
    return link;
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
        const tags = state.allForm?.tags ?? [];
        const index = tags.indexOf(label);
        if (index >= 0) {
          controller.removeTag(index);
        }
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
        background(controller.runPreset(preset.id, preset.name));
      });
      cached = { label, node, shown: '' };
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

  function syncPresets(): void {
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
      if (!presetList.isConnected) {
        presetsSection.insertBefore(presetList, presetHint);
      }
      syncChildren(
        presetList,
        presetActions.map((preset) => presetNode(preset)),
      );
      presetHint.remove();
    } else {
      presetList.remove();
      if (!presetHint.isConnected) {
        presetsSection.append(presetHint);
      }
    }
  }

  function tokenValue(token: string, subtitle: string, gameName: string): string {
    return token === GAME_TOKEN ? gameName.trim() : subtitle.trim();
  }

  function finalPreview(template: string, subtitle: string, gameName: string): string {
    return splitTemplate(template)
      .map((part) =>
        part === TEMPLATE_TOKEN || part === GAME_TOKEN
          ? tokenValue(part, subtitle, gameName) || part
          : part,
      )
      .join('');
  }

  function previewNodes(template: string, subtitle: string, gameName: string): Node[] {
    const nodes: Node[] = [];
    for (const part of splitTemplate(template)) {
      if (!part) {
        continue;
      }
      if (part === TEMPLATE_TOKEN || part === GAME_TOKEN) {
        const value = tokenValue(part, subtitle, gameName);
        const mark = document.createElement('mark');
        mark.className = value ? 'template-value' : 'template-token';
        setText(mark, value || part);
        nodes.push(mark);
      } else {
        nodes.push(document.createTextNode(part));
      }
    }
    return nodes;
  }

  function platformEditable(platform: Platform, form: AllForm | null): boolean {
    const enabled = platform === 'twitch' ? settings.twitchEnabled : settings.youtubeEnabled;
    return Boolean(form) && !cardBusy && enabled && controller.platformAvailable(platform);
  }

  function templateFor(platform: Platform): string {
    return platform === 'twitch'
      ? state.templateDraft.twitchTemplate
      : state.templateDraft.youtubeTemplate;
  }

  function templateError(platform: Platform, template: string): string | null {
    if (isTemplateValid(template)) {
      return null;
    }
    return t(platform === 'twitch' ? 'twitchTemplateValidation' : 'youtubeTemplateValidation');
  }

  function sharedTagMessages(): string[] {
    return [
      t('twitchTagsTooMany'),
      t('twitchTagsInvalid'),
      t('twitchTagsDuplicate'),
      t('youtubeTagsTooLong'),
    ];
  }

  function titleMessagesFor(platform: Platform): string[] {
    return platform === 'twitch'
      ? [t('twitchTitleRequired'), t('twitchTitleTooLong')]
      : [t('youtubeTitleRequired'), t('youtubeTitleTooLong'), t('youtubeTitleInvalid')];
  }

  function titleLimit(platform: Platform): number {
    return platform === 'twitch' ? 140 : 100;
  }

  function syncSharedTags(): void {
    const form = state.allForm;
    const tags = form?.tags ?? [];
    const editable =
      Boolean(form) &&
      !cardBusy &&
      (controller.platformAvailable('twitch') || controller.platformAvailable('youtube'));
    syncChildren(
      sharedTagList,
      tags.map((tag) => chipNode(tag, editable)),
    );
    patchField(sharedTagField, form?.tagDraft ?? '', !editable);
    sharedAddTag.disabled = !(editable && form?.tagDraft.trim());
    const tagErrors = controller
      .errors()
      .filter((message) => sharedTagMessages().includes(message));
    setText(sharedTagError, tagErrors.join(' '));
    setAttribute(sharedTagField.input, 'aria-invalid', tagErrors.length > 0);
  }

  function syncTitle(editor: PlatformEditor, form: AllForm | null): void {
    const { platform } = editor;
    const editable = platformEditable(platform, form);
    const template = templateFor(platform);
    editor.template.update(template, cardBusy, templateError(platform, template));
    const finalTitle = form ? controller.title(platform) : '';
    const gameName = state.stream?.twitch.categoryName ?? '';
    if (editor.preview.textContent !== finalPreview(template, form?.subtitle ?? '', gameName)) {
      editor.preview.replaceChildren(...previewNodes(template, form?.subtitle ?? '', gameName));
    }
    const limit = titleLimit(platform);
    setText(editor.counter, `${finalTitle.length} / ${limit}`);
    if (finalTitle.length > limit !== editor.counter.classList.contains('invalid')) {
      editor.counter.classList.toggle('invalid', finalTitle.length > limit);
    }
    const mode = form ? formTitleMode(form, platform) : 'subtitle';
    editor.subtitleMode.setAttribute('aria-pressed', String(mode === 'subtitle'));
    editor.fullMode.setAttribute('aria-pressed', String(mode === 'full'));
    editor.subtitleMode.disabled = !editable;
    editor.fullMode.disabled = !editable;
    editor.fullTitle.root.hidden = mode !== 'full';
    patchField(editor.fullTitle, form ? formTitle(form, platform) : '', !editable);
    const titleErrors = controller
      .errors()
      .filter((message) => titleMessagesFor(platform).includes(message));
    setText(editor.titleError, titleErrors.join(' '));
    setAttribute(editor.fullTitle.input, 'aria-invalid', titleErrors.length > 0);
  }

  function syncYouTubeCategory(
    select: HTMLSelectElement,
    form: AllForm | null,
    editable: boolean,
  ): void {
    if (!form) {
      return;
    }
    const wanted = form.youtubeCategoryName;
    if (wanted && !Array.from(select.options).some((option) => option.value === wanted)) {
      const option = el('option');
      option.value = wanted;
      setText(option, wanted);
      select.append(option);
    }
    if (select.value !== wanted) {
      select.value = wanted;
    }
    select.disabled = !editable;
  }

  function syncCategory(editor: PlatformEditor, form: AllForm | null): void {
    const { platform } = editor;
    const editable = platformEditable(platform, form);
    if (editor.categorySearch) {
      editor.categorySearch.update({
        disabled: !editable,
        error: search.searchError,
        hasMore: search.searchHasMore,
        limit: search.visibleCategories,
        loading: search.twitchSearching,
        partial: search.searchPartial,
        query: form?.twitchCategoryQuery ?? '',
        results: state.twitchResults,
        selected: form?.twitchCategory ?? null,
        warnings: search.searchWarnings,
      });
    }
    if (editor.categorySelect) {
      syncYouTubeCategory(editor.categorySelect, form, editable);
    }
    const categoryMessages =
      platform === 'youtube' ? [t('categorySelectionRequired', { platform: 'YouTube' })] : [];
    const categoryErrors = controller
      .errors()
      .filter((message) => categoryMessages.includes(message));
    setText(editor.categoryError, categoryErrors.join(' '));
  }

  function syncEditorLoading(editor: PlatformEditor, loading: boolean): void {
    if (loading) {
      if (!editor.loadingNote.isConnected) {
        editor.root.insertBefore(editor.loadingNote, editor.editor);
      }
      setText(editor.loadingNote, t('updating'));
    } else if (editor.loadingNote.isConnected) {
      editor.loadingNote.remove();
    }
  }

  function warningFor(platform: Platform, enabled: boolean): string {
    const info = state.stream?.[platform];
    if (!enabled) {
      return t('platformDisabled');
    }
    if (!info?.connected) {
      return t('accountNotConnected');
    }
    return platform === 'youtube' && !info.live ? t('youtubeNotStarted') : '';
  }

  function syncEditorWarning(editor: PlatformEditor, warning: string): void {
    if (!warning) {
      editor.warning.remove();
      return;
    }
    if (!editor.warning.isConnected) {
      editor.root.append(editor.warning);
    }
    setText(editor.warning, warning);
  }

  function syncPlatformEditor(editor: PlatformEditor): void {
    const { platform } = editor;
    const form = state.allForm;
    const info = state.stream?.[platform];
    const enabled = platform === 'twitch' ? settings.twitchEnabled : settings.youtubeEnabled;
    const loading = controller.platformLoading(platform);
    const status = controller.cardStatus(platform);
    const effect = state.cardEffects[platform];
    editor.root.className = composeClass('platform-card dock-section', [
      status,
      state.cardErrors[platform] ? 'card-error' : '',
      effect ? `card-${effect}` : '',
      enabled ? '' : 'platform-card--disabled',
    ]);
    setAttribute(editor.root, 'aria-busy', loading);
    setText(editor.accountName, info?.accountName || t('accountNotConnected'));
    editor.badge.className = `live-status-badge live-status-badge--${status}`;
    const badgeLabel = t(badgeMessage(status));
    if (editor.badgeText.data !== badgeLabel) {
      editor.badgeText.data = badgeLabel;
    }
    syncEditorLoading(editor, loading);
    const editable = platformEditable(platform, form);
    setAttribute(editor.editor, 'disabled', !editable);
    syncTitle(editor, form);
    syncCategory(editor, form);
    syncEditorWarning(editor, warningFor(platform, enabled));
  }

  function syncContent(): void {
    if (!(state.stream && state.allForm)) {
      return;
    }
    cardBusy = controller.busy();
    patchField(subtitleField, state.allForm.subtitle, cardBusy);
    const titleMessages = [
      t('twitchTitleRequired'),
      t('twitchTitleTooLong'),
      t('youtubeTitleRequired'),
      t('youtubeTitleTooLong'),
      t('youtubeTitleInvalid'),
    ];
    const titleErrors = Array.from(
      new Set(controller.errors().filter((message) => titleMessages.includes(message))),
    );
    setText(subtitleError, titleErrors.join(' '));
    setAttribute(subtitleField.input, 'aria-invalid', titleErrors.length > 0);
    setText(templateDirty, state.templatesDirty ? t('templatesUnsaved') : '');
    syncSharedTags();
    syncPlatformEditor(twitchEditor);
    syncPlatformEditor(youtubeEditor);
    syncPresets();
  }

  function patchLink(link: HTMLAnchorElement, href: string | null): void {
    if (href) {
      if (link.getAttribute('href') !== href) {
        link.href = href;
      }
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
      if (!emptyError.isConnected) {
        mainEl?.append(emptyError);
      }
      setText(emptyError, message);
    } else {
      emptyError.remove();
    }
  }

  // Save panel ----------------------------------------------------------------
  function saveStatusText(): string {
    if (state.allSaving) {
      return t('saving');
    }
    if (state.allDirty) {
      return t(state.allSaveResult === 'partial' ? 'changesPartlyApplied' : 'changesUnsaved');
    }
    if (state.allSaveResult) {
      return t('changesApplied');
    }
    return t('changesReady');
  }

  function buildSavePanel(): HTMLElement {
    const root = el('section', 'save-panel');
    root.setAttribute('aria-label', t('editInfo'));
    saveStatus = el('p', 'save-status');
    saveStatus.setAttribute('role', 'status');
    saveStatus.setAttribute('aria-live', 'polite');
    saveMeta = el('div', 'save-meta');
    saveMeta.append(saveStatus);
    const apply = appButton('primary', { label: t('applyChanges') });
    applyButton = apply.root;
    applyButton.addEventListener('click', () => {
      background(controller.saveAll());
    });
    errorsHost = el('div', 'form-errors');
    errorsHost.setAttribute('role', 'status');
    root.append(applyButton, saveMeta, errorsHost);
    return root;
  }

  // Индикатор подключения держится в нижней панели, пока она есть, иначе — в шапке.
  function mountIndicator(): void {
    const home = saveMeta ?? titleHolder;
    if (indicator.parentElement !== home) {
      home.append(indicator);
    }
  }

  function syncSave(): void {
    if (!(saveStatus && applyButton && errorsHost)) {
      return;
    }
    setText(saveStatus, saveStatusText());
    saveStatus.className = composeClass('save-status', [
      state.allDirty ? 'is-dirty' : '',
      !state.allDirty && state.allSaveResult ? 'is-saved' : '',
    ]);
    const errors = controller.errors();
    const templatesChanged =
      state.templatesDirty ||
      (state.allForm?.subtitle.trim() ?? '') !== controller.settings.lastSubtitle;
    applyButton.disabled =
      errors.length > 0 ||
      controller.busy() ||
      !(
        controller.platformAvailable('twitch') ||
        controller.platformAvailable('youtube') ||
        templatesChanged
      );
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
      if (cached.signature === signature) {
        return cached.node;
      }
      cached.node.remove();
      noticeCache.delete(notice.id);
    }
    const node = el('div', `notice notice--${notice.kind}`);
    node.setAttribute('role', notice.kind === 'error' ? 'alert' : 'status');
    const iconBox = el('span', 'notice__icon');
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.innerHTML = uiIcon(
      (() => {
        if (notice.kind === 'error') {
          return 'error';
        }
        if (notice.kind === 'warning') {
          return 'warning';
        }
        if (notice.kind === 'success') {
          return 'check';
        }
        return 'info';
      })(),
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
    // Модалка могла закрываться, когда пользователь уже открыл следующую:
    // уходящая подложка не должна перекрывать новую.
    for (const stale of host.querySelectorAll('.modal-backdrop')) {
      stale.remove();
    }
    if (modalExitTimer !== null) {
      window.clearTimeout(modalExitTimer);
      modalExitTimer = null;
    }
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
    const modalTitle = el('h2');
    modalTitle.id = 'settings-title';
    setText(modalTitle, t('settings'));
    titleBox.append(modalTitle);
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
      max: 65_535,
      min: 1,
      type: 'number',
    });
    const endpointField = buildField({ id: 'settings-endpoint-input', label: 'Endpoint' });
    const passwordField = buildField({
      autocomplete: 'current-password',
      id: 'settings-password-input',
      label: t('password'),
      type: 'password',
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
    modalMeta = el('p', 'settings-meta');
    modalMeta.setAttribute('role', 'status');
    modalFooter.append(save.root, modalMeta);

    dialog.append(modalHeader, modalBody, modalFooter);
    backdrop.append(dialog);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        controller.closeSettings();
      }
    });
    backdrop.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        controller.closeSettings();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      trapModalFocus(dialog, event);
    });
    backdrop.append(dialog);
    modalBackdrop = backdrop;
    modalKeys = {
      endpoint: endpointField,
      host: hostField,
      password: passwordField,
      port: portField,
      remember,
    };
    // Инертная оболочка не должна накрывать сам модал: монтируем backdrop
    // рядом с shell, а не внутри.
    host.append(backdrop);
    backdrop.classList.add('settings-enter-active', 'settings-enter-from');
    // Синхронный пересчёт фиксирует стартовую позу до включения перехода.
    backdrop.getBoundingClientRect();
    backdrop.classList.remove('settings-enter-from');
    dialog.querySelector<HTMLElement>('button, input, textarea')?.focus();
  }

  function trapModalFocus(dialog: HTMLElement, event: KeyboardEvent): void {
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
  }

  function retireModal(): void {
    const backdrop = modalBackdrop;
    modalBackdrop = null;
    modalKeys = null;
    modalNoticesHost = null;
    modalMeta = null;
    if (!backdrop) {
      return;
    }
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
    backdrop.classList.remove('settings-enter-active', 'settings-enter-from');
    backdrop.classList.add('settings-leave-active', 'settings-leave-to');
    // Ждём фактическую длительность перехода: при reduced-motion или в среде
    // без таблицы стилей она нулевая и подложка снимается сразу.
    const exit = Number.parseFloat(window.getComputedStyle(backdrop).transitionDuration);
    if (Number.isFinite(exit) && exit > 0) {
      modalExitTimer = window.setTimeout(
        () => {
          modalExitTimer = null;
          finish();
        },
        exit * 1000 + 1,
      );
    } else {
      finish();
    }
  }

  function syncModalFields(): void {
    const keys = modalKeys;
    if (!keys) {
      return;
    }
    const draft = state.settingsDraft;
    patchFocusableField(keys.host, draft.host);
    patchFocusableField(keys.port, String(draft.port));
    patchFocusableField(keys.endpoint, draft.endpoint);
    patchFocusableField(keys.password, draft.password);
    if (keys.remember.checked !== draft.rememberPassword) {
      keys.remember.checked = draft.rememberPassword;
    }
  }
  function patchFocusableField(field: Field, value: string): void {
    if (field.input.value === value) {
      return;
    }
    if (document.activeElement === field.input) {
      return;
    }
    field.input.value = value;
  }

  function syncSavePanel(): void {
    const wantSave = state.stream !== null && !SETUP_STATUSES.includes(state.actionStatus);
    if (wantSave && !savePanel) {
      savePanel = buildSavePanel();
      shell.append(savePanel);
    } else if (!wantSave && savePanel) {
      savePanel.remove();
      savePanel = null;
      saveMeta = null;
      saveStatus = null;
      applyButton = null;
      errorsHost = null;
      errorsJoined = '';
    }
    mountIndicator();
    if (savePanel) {
      syncSave();
    }
  }

  function syncSettingsModal(): void {
    const wantModal = state.modal === 'settings';
    shell.toggleAttribute('inert', wantModal);
    if (wantModal && !modalBackdrop) {
      for (const child of [...noticesHost.children]) {
        child.remove();
      }
      buildModal();
    } else if (!wantModal && modalBackdrop) {
      retireModal();
    }
    if (modalBackdrop) {
      syncModalFields();
      syncModalMeta();
      if (modalNoticesHost) {
        syncNotices(modalNoticesHost);
      }
    }
  }

  // Версия и время последнего обновления — служебные сведения, поэтому они
  // живут в модалке «Настройки», а не в постоянном футере дока.
  function syncModalMeta(): void {
    if (!modalMeta) {
      return;
    }
    const updated =
      state.lastUpdated?.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) ?? '—';
    setText(modalMeta, `Stream Info ${controller.version} · ${t('updated')} ${updated}`);
  }

  // Render pass -----------------------------------------------------------------
  function syncHeaderLinks(): void {
    const login = state.stream?.twitch.login || '';
    if (login) {
      patchLink(streamLink, `https://www.twitch.tv/${encodeURIComponent(login)}`);
      patchLink(
        dashboardLink,
        `https://dashboard.twitch.tv/u/${encodeURIComponent(login)}/stream-manager`,
      );
      setAttribute(streamLink, 'hidden', false);
      setAttribute(dashboardLink, 'hidden', false);
      return;
    }
    const youtube = state.stream?.youtube;
    const broadcastId = youtube?.broadcastId || '';
    const channelId = youtube?.channelId || '';
    patchLink(
      streamLink,
      broadcastId ? `https://www.youtube.com/watch?v=${encodeURIComponent(broadcastId)}` : null,
    );
    let dashboardHref: string | null = null;
    if (broadcastId) {
      dashboardHref = `https://studio.youtube.com/video/${encodeURIComponent(broadcastId)}/livestreaming`;
    } else if (channelId) {
      dashboardHref = `https://studio.youtube.com/channel/${encodeURIComponent(channelId)}/livestreaming/dashboard`;
    } else if (youtube?.connected) {
      dashboardHref = 'https://studio.youtube.com/';
    }
    patchLink(dashboardLink, dashboardHref);
    // Без аккаунта ссылки некуда вести: скрываем их, чтобы не оставлять в шапке
    // нерабочие кнопки.
    setAttribute(streamLink, 'hidden', !broadcastId);
    setAttribute(dashboardLink, 'hidden', !(broadcastId || channelId || youtube?.connected));
  }

  function render(): void {
    setAttribute(statusDot, 'data-status', state.connection);
    setText(statusText, controller.connectionText());
    setAttribute(refresh.root, 'disabled', state.connection !== 'connected');
    syncHeaderLinks();

    let kind: Exclude<MainKind, null>;
    if (state.authNeeded) {
      kind = 'auth';
    } else if (SETUP_STATUSES.includes(state.actionStatus)) {
      kind = 'setup';
    } else if (state.stream) {
      kind = 'content';
    } else {
      kind = 'empty';
    }
    if (kind === 'auth') {
      switchRegion('auth', buildAuth, syncAuth);
    } else if (kind === 'setup') {
      switchRegion('setup', buildSetup, syncSetup);
    } else if (kind === 'content') {
      switchRegion('content', buildContent, syncContent);
    } else {
      switchRegion('empty', buildEmpty, syncEmpty);
    }

    syncSavePanel();
    if (state.modal === null) {
      syncNotices(noticesHost);
    }
    for (const child of [...noticesHost.children]) {
      if (state.modal !== null) {
        child.remove();
      }
    }

    syncSettingsModal();
  }

  const renderListener = (): void => render();
  const unsubscribe = subscribe(renderListener);
  render();
  controller.start();
  return {
    dispose(): void {
      if (disposed) {
        return;
      }
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
