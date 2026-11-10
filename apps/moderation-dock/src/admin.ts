import {
  type ConfigPayload,
  control,
  fetchHistory,
  fetchState,
  importHistory,
  type ModerationItemView,
  type ModerationState,
  reviewItem,
  saveConfig,
  testProvider,
} from './api';

const STATUS_LABELS: Record<string, string> = {
  allowed: 'Разрешён',
  blocked: 'Заблокирован',
  checking: 'Проверяется',
  delivery_unknown: 'Неизвестно',
  displayed: 'Показан',
  displaying: 'В эфире',
  historical: 'История',
  pending: 'В очереди',
  review: 'Проверка',
};

const FILTERS: Array<{ key: string; label: string; test: (item: ModerationItemView) => boolean }> =
  [
    { key: 'all', label: 'Все', test: () => true },
    {
      key: 'review',
      label: 'На проверке',
      test: (item) => item.status === 'review',
    },
    {
      key: 'pending',
      label: 'В очереди',
      test: (item) => item.status === 'pending' || item.status === 'checking',
    },
    {
      key: 'allowed',
      label: 'Разрешённые',
      test: (item) =>
        item.status === 'allowed' || item.status === 'displaying' || item.status === 'displayed',
    },
    { key: 'blocked', label: 'Заблокированные', test: (item) => item.status === 'blocked' },
    { key: 'history', label: 'История', test: (item) => item.status === 'historical' },
  ];

const REASON_LABELS: Record<string, string> = {
  ambiguous_tone: 'неоднозначный тон',
  audio_requires_manual_review: 'голосовое — нужна ручная проверка',
  delivery_unknown: 'доставка не подтверждена',
  historical_import: 'история до модерации',
  input_too_long: 'слишком длинный текст',
  invalid_decision: 'некорректный ответ модели',
  missing_key: 'не задан ключ провайдера',
  providers_unavailable: 'провайдеры недоступны',
  queue_overflow: 'переполнена очередь',
  restart_during_check: 'перезапуск во время проверки',
  restart_during_delivery: 'перезапуск во время показа',
  rules_not_configured: 'не заданы правила',
  spam_link: 'ссылка или спам',
};

function reasonLabel(reason: string): string {
  if (!reason) {
    return '';
  }
  return REASON_LABELS[reason] || reason.replaceAll('_', ' ');
}

function escapeHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function must<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function statusClass(status: string): string {
  return `status status--${status}`;
}

function itemKey(item: ModerationItemView): string {
  return `${item.platform}:${item.id}`;
}

function currencyLabel(currency: string): string {
  const code = (currency || '').toUpperCase();
  if (code === 'RUB' || code === 'RUR') {
    return '₽';
  }
  if (code === 'USD') {
    return '$';
  }
  if (code === 'EUR') {
    return '€';
  }
  if (code === 'KZT') {
    return '₸';
  }
  if (code === 'UAH') {
    return '₴';
  }
  return code;
}

const AMOUNT_TRAILING_ZERO = /\.0+$/;
const AMOUNT_ONE_DECIMAL_ZERO = /(\.\d)0$/;

function amountLabel(item: ModerationItemView): string {
  const amount = (item.amount || '')
    .replace(AMOUNT_TRAILING_ZERO, '')
    .replace(AMOUNT_ONE_DECIMAL_ZERO, '$1');
  const currency = currencyLabel(item.currency);
  return [amount, currency].filter(Boolean).join(' ');
}

function dateTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: '2-digit' }),
  });
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

function initial(name: string): string {
  return (name || '?').trim().slice(0, 1).toLowerCase();
}

function toast(root: HTMLElement, text: string, kind: 'ok' | 'bad' = 'ok'): void {
  const node = must<HTMLElement>(root, '#toast');
  node.textContent = text;
  node.className = `toast toast--${kind} show`;
  window.clearTimeout(Number(node.dataset.timer || 0));
  const timer = window.setTimeout(() => {
    node.className = 'toast';
  }, 3200);
  node.dataset.timer = String(timer);
}

export function mountAdmin(root: HTMLElement): void {
  root.innerHTML = `
    <div class="admin">
      <header class="admin__top">
        <div class="brand">
          <span>донаты <span class="brand__sub">maseaaao.tv</span></span>
        </div>
        <div class="top__status" id="top-status"></div>
        <div class="top__actions">
          <button class="btn btn--small" id="toggle-output" type="button">Пауза</button>
          <button class="btn btn--small" id="restart-engine" type="button">Перезапуск</button>
          <button class="btn btn--small btn--ghost" id="open-settings" type="button">Настройки</button>
        </div>
      </header>
      <div class="admin__body">
        <section class="workspace">
          <div class="toolbar">
            <input class="search" id="search" type="search" placeholder="Имя, текст или ID" autocomplete="off" />
            <button class="btn btn--small" id="refresh" type="button">Обновить</button>
          </div>
          <div class="filters" id="filters"></div>
          <div class="history-toolbar" id="history-toolbar" hidden>
            <span class="history-toolbar__hint">Архив DonationAlerts</span>
            <button class="btn btn--small" id="import-history" type="button">Загрузить историю</button>
          </div>
          <div class="list" id="list"><div class="empty"><div><p class="empty__title">Загрузка…</p><p class="empty__text">Подключаюсь к локальному сервису модерации.</p></div></div></div>
        </section>
        <aside class="detail" id="detail"></aside>
      </div>
    </div>
    <div class="modal" id="settings-modal" hidden>
      <form class="sheet" id="settings-form">
        <div class="sheet__head">
          <div>
            <h2 class="sheet__title">Настройки модерации</h2>
            <p class="sheet__sub">Ключи и правила хранятся только на этом компьютере в DPAPI. В браузер они не возвращаются.</p>
          </div>
          <button class="btn btn--small btn--ghost" id="close-settings" type="button" aria-label="Закрыть">Закрыть</button>
        </div>
        <div class="sheet__body">
          <section class="section">
            <h3 class="section__title">Провайдеры</h3>
            <div class="provider">
              <div class="provider__head">
                <span class="provider__name">OpenCode Go</span>
                <span class="provider__state" id="go-key-state">не задан</span>
              </div>
              <span class="field__label">API-ключ</span>
              <div class="key-row">
                <input class="input" id="go-key" type="password" autocomplete="off" aria-label="API-ключ OpenCode Go" placeholder="Ключ OpenCode Go" />
                <button class="btn btn--small" id="test-go" type="button">Проверить</button>
              </div>
              <label class="toggle"><input id="clear-go" type="checkbox" /><span class="toggle__body"><span class="toggle__title">Удалить сохранённый ключ Go</span></span></label>
              <div class="grid-2">
                <label class="field"><span class="field__label">Модель</span><select class="input" id="go-model"><option value="deepseek-v4.1-flash">DeepSeek V4.1 Flash</option><option value="glm-5.3-flash">GLM-5.3 Flash</option><option value="minimax-m3.1-flash">MiniMax M3.1 Flash</option><option value="beam-free">Beam Free</option><option value="qwen3.8-flash">Qwen3.8 Flash</option><option value="hy4-preview">Hy4 Preview</option><option value="hy4">Hy4</option><option value="iceman-contributor-free">Iceman Contributor Free</option></select></label>
                <label class="field"><span class="field__label">Reasoning</span><select class="input" id="go-reasoning"><option value="low">Низкий</option><option value="medium">Средний (med)</option><option value="high">Высокий</option><option value="xhigh">Очень высокий</option><option value="max">Максимальный</option><option value="none">Без reasoning</option></select></label>
              </div>
              <div class="field__hint" id="go-test">Проверка делает один короткий запрос к провайдеру.</div>
            </div>
            <div class="provider" style="margin-top:10px">
              <div class="provider__head">
                <span class="provider__name">DeepSeek · резерв</span>
                <span class="provider__state" id="deepseek-key-state">не задан</span>
              </div>
              <span class="field__label">API-ключ</span>
              <div class="key-row">
                <input class="input" id="deepseek-key" type="password" autocomplete="off" aria-label="API-ключ DeepSeek" placeholder="Ключ DeepSeek" />
                <button class="btn btn--small" id="test-deepseek" type="button">Проверить</button>
              </div>
              <label class="toggle"><input id="clear-deepseek" type="checkbox" /><span class="toggle__body"><span class="toggle__title">Удалить сохранённый ключ DeepSeek</span></span></label>
              <label class="field"><span class="field__label">Модель</span><input class="input" id="deepseek-model" type="text" autocomplete="off" /></label>
              <div class="field__hint" id="deepseek-test">Резерв используется, если основной провайдер вернул ошибку.</div>
            </div>
          </section>
          <section class="section">
            <h3 class="section__title">Поведение</h3>
            <div class="grid-2">
              <label class="field"><span class="field__label">Таймаут провайдера, сек</span><input class="input" id="timeout" type="number" min="1" max="30" /></label>
              <label class="field"><span class="field__label">Длительность показа, сек</span><input class="input" id="display-seconds" type="number" min="3" max="60" step="1" inputmode="numeric" /><span class="field__hint">3–60 секунд: сколько карточка остаётся в эфире.</span></label>
            </div>
            <label class="field"><span class="field__label">Правила модератора</span><textarea class="textarea" id="rules"></textarea></label>
            <label class="toggle"><input id="paused" type="checkbox" /><span class="toggle__body"><span class="toggle__title">Пауза</span><span class="toggle__text">Очередь наполняется, но разрешённые донаты не выводятся.</span></span></label>
            <label class="toggle"><input id="outputs-ready" type="checkbox" /><span class="toggle__body"><span class="toggle__title">Вывод разрешён</span><span class="toggle__text">Включай только после того, как старый виджет DonationAlerts отключён, а источник AI | Донат загружен. Иначе возможен двойной показ.</span></span></label>
          </section>
        </div>
        <div class="sheet__foot">
          <button class="btn btn--small" id="cancel-settings" type="button">Отмена</button>
          <button class="btn btn--small btn--primary" id="save-settings" type="submit">Сохранить</button>
        </div>
      </form>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `;

  const list = must<HTMLElement>(root, '#list');
  const detail = must<HTMLElement>(root, '#detail');
  const topStatus = must<HTMLElement>(root, '#top-status');
  const search = must<HTMLInputElement>(root, '#search');
  const filters = must<HTMLElement>(root, '#filters');
  const toggle = must<HTMLButtonElement>(root, '#toggle-output');
  const modal = must<HTMLElement>(root, '#settings-modal');
  const form = must<HTMLFormElement>(root, '#settings-form');
  let state: ModerationState | null = null;
  let historyItems: ModerationItemView[] = [];
  let selected = '';
  let filter = 'all';
  let loading = false;
  let historyLoading = false;
  let settingsOpen = false;
  let autoSelected = false;

  const setState = (next: ModerationState) => {
    state = next;
    if (!autoSelected && window.innerWidth > 920 && !selected) {
      autoSelected = true;
      const first = next.items.find((item) => item.status === 'review') || next.items[0];
      if (first) {
        selected = itemKey(first);
      }
    }
    render();
  };

  const load = async (quiet = false) => {
    if (loading) {
      return;
    }
    loading = true;
    try {
      setState(await fetchState());
    } catch {
      if (!quiet) {
        toast(root, 'Локальный сервис модерации недоступен', 'bad');
      }
      topStatus.innerHTML = '<span class="chip chip--bad">сервис недоступен</span>';
    } finally {
      loading = false;
    }
  };

  const loadHistory = async (quiet = false) => {
    if (historyLoading) {
      return;
    }
    historyLoading = true;
    try {
      const result = await fetchHistory();
      historyItems = result.items;
      if (filter === 'history') {
        renderList();
        renderDetail();
      }
    } catch {
      if (!quiet) {
        toast(root, 'История DonationAlerts недоступна', 'bad');
      }
    } finally {
      historyLoading = false;
    }
  };

  const renderTop = () => {
    if (!state) {
      return;
    }
    const chips: string[] = [];
    chips.push(
      state.config.outputsReady
        ? '<span class="chip chip--ok">вывод открыт</span>'
        : '<span class="chip chip--bad">вывод закрыт</span>',
    );
    if (!state.config.hasGoKey) {
      chips.push('<span class="chip chip--warn">нет ключа Go</span>');
    }
    if (state.lastError) {
      chips.push('<span class="chip chip--warn" title="Последняя ошибка провайдера">ошибка</span>');
    }
    topStatus.innerHTML = chips.join('');
    toggle.textContent = state.config.paused ? 'Продолжить' : 'Пауза';
    toggle.className = `btn btn--small ${state.config.paused ? 'btn--pause' : ''}`;
  };

  const renderFilters = () => {
    filters.innerHTML = FILTERS.map((entry) => {
      let count = 0;
      if (entry.key === 'history') {
        count = state?.counts.historical ?? historyItems.length;
      } else if (state) {
        count = state.items.filter((item) => entry.test(item)).length;
      }
      return `<button class="filter" data-filter="${entry.key}" type="button" aria-pressed="${entry.key === filter}">${entry.label}<span class="filter__count">${count}</span></button>`;
    }).join('');
    must<HTMLElement>(root, '#history-toolbar').hidden = filter !== 'history';
  };

  const filteredItems = (): ModerationItemView[] => {
    if (!state) {
      return [];
    }
    const needle = search.value.trim().toLowerCase();
    const predicate = FILTERS.find((entry) => entry.key === filter)?.test ?? (() => true);
    const source = filter === 'history' ? historyItems : state.items;
    return source.filter((item) => {
      if (!predicate(item)) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [item.username, item.message, item.id, item.platform].some((value) =>
        (value || '').toLowerCase().includes(needle),
      );
    });
  };

  const actionHtml = (item: ModerationItemView): string => {
    const buttons: string[] = [];
    if (item.status === 'review' || item.status === 'blocked') {
      buttons.push(
        `<button class="btn btn--small btn--primary" data-op="allow" type="button">Разрешить</button>`,
      );
    }
    if (item.status === 'review' || item.status === 'allowed' || item.status === 'displaying') {
      buttons.push(
        `<button class="btn btn--small btn--danger" data-op="block" type="button">Заблокировать</button>`,
      );
    }
    if (
      (item.status === 'review' || item.status === 'blocked') &&
      item.kind !== 'audio' &&
      item.reason !== 'input_too_long'
    ) {
      buttons.push(
        `<button class="btn btn--small" data-op="retry" type="button">Перепроверить</button>`,
      );
    }
    if (item.status === 'checking' || item.status === 'displaying') {
      buttons.push(
        `<button class="btn btn--small" type="button" disabled title="Дождись завершения текущей проверки или показа">Повтор</button>`,
      );
    } else {
      buttons.push(
        `<button class="btn btn--small" data-op="replay" type="button" title="Снова вывести донат в чат и OBS">Повтор</button>`,
      );
    }
    if (item.hasAudio) {
      buttons.push('<span class="status">голос</span>');
    }
    return buttons.join('');
  };

  const renderList = () => {
    if (!state) {
      return;
    }
    const items = filteredItems();
    if (items.length === 0) {
      const isHistory = filter === 'history';
      const hasSearch = search.value.trim().length > 0;
      let title = 'Очередь пуста';
      let text = 'Новые донаты появятся здесь после проверки.';
      if (hasSearch) {
        title = 'Ничего не найдено';
        text = 'Измени запрос или выбери другой фильтр.';
      } else if (isHistory) {
        title = 'История пуста';
        text = 'Нажми «Загрузить историю», чтобы подтянуть старые донаты.';
      }
      list.innerHTML = `<div class="empty"><div><p class="empty__title">${title}</p><p class="empty__text">${text}</p></div></div>`;
      return;
    }
    list.innerHTML = items
      .map((item) => {
        const selectedAttr = selected === itemKey(item) ? 'true' : 'false';
        return `<article class="item" data-key="${escapeHtml(itemKey(item))}" aria-selected="${selectedAttr}" tabindex="0">
          <span class="item__avatar">${escapeHtml(initial(item.username))}</span>
          <div class="item__main">
            <div class="item__meta">
              <span class="item__name">${escapeHtml(item.username || 'Аноним')}</span>
              <span class="item__amount">${escapeHtml(amountLabel(item))}</span>
              <span class="item__time">${escapeHtml(dateTimeLabel(item.createdUtc))}</span>
            </div>
            <div class="item__message">${escapeHtml(item.message || 'Без текста')}</div>
            <div class="item__foot">
              <span class="${statusClass(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
              ${item.reason ? `<span class="item__reason" title="${escapeHtml(item.reason)}">${escapeHtml(reasonLabel(item.reason))}</span>` : ''}
            </div>
          </div>
          <div class="item__actions">${actionHtml(item)}</div>
        </article>`;
      })
      .join('');
  };

  const renderDetail = () => {
    if (!state) {
      return;
    }
    const item =
      state.items.find((entry) => itemKey(entry) === selected) ||
      historyItems.find((entry) => itemKey(entry) === selected);
    if (!item) {
      detail.classList.remove('open');
      detail.innerHTML = `<div class="detail__head"><div><h2 class="detail__title">Выбери донат</h2><p class="detail__sub">Карточка откроется здесь. Для проверки голосового сообщения используй плеер.</p></div></div>`;
      return;
    }
    detail.innerHTML = `
      <div class="detail__head">
        <div>
          <h2 class="detail__title">${escapeHtml(item.username || 'Аноним')}</h2>
          <p class="detail__sub">${escapeHtml(item.platform)} · ${escapeHtml(dateTimeLabel(item.createdUtc))}</p>
        </div>
        <button class="btn btn--small btn--ghost" id="close-detail" type="button" aria-label="Закрыть карточку">Закрыть</button>
      </div>
      <div class="detail__body">
        <p class="detail__amount">${escapeHtml(amountLabel(item))}</p>
        <p class="detail__message">${escapeHtml(item.message || 'Без текста')}</p>
        ${item.hasAudio ? `<audio class="audio" controls preload="none" src="${escapeHtml(item.audioUrl)}"></audio><p class="detail__hint">Голосовое сообщение провайдера. Прослушай перед разрешением.</p>` : ''}
        <div class="detail__grid">
          <div class="detail__row"><span class="detail__key">Статус</span><span class="detail__value"><span class="${statusClass(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></span></div>
          <div class="detail__row"><span class="detail__key">Причина</span><span class="detail__value">${escapeHtml(reasonLabel(item.reason) || '—')}</span></div>
          <div class="detail__row"><span class="detail__key">Провайдер</span><span class="detail__value">${escapeHtml(item.provider || '—')}</span></div>
          ${item.providerError ? `<div class="detail__row"><span class="detail__key">Ошибка</span><span class="detail__value">${escapeHtml(item.providerError)}</span></div>` : ''}
          ${item.reason ? `<div class="detail__row"><span class="detail__key">Код</span><span class="detail__value">${escapeHtml(item.reason)}</span></div>` : ''}
          <div class="detail__row"><span class="detail__key">ID</span><span class="detail__value">${escapeHtml(item.id)}</span></div>
          ${item.convertedAmount ? `<div class="detail__row"><span class="detail__key">В валюте</span><span class="detail__value">${escapeHtml(item.convertedAmount)}</span></div>` : ''}
        </div>
      </div>
      <div class="detail__actions">${actionHtml(item)}</div>
    `;
    detail.classList.add('open');
  };

  const render = () => {
    if (!state) {
      return;
    }
    renderTop();
    renderFilters();
    renderList();
    renderDetail();
    if (settingsOpen) {
      must<HTMLElement>(root, '#go-key-state').textContent = state.config.hasGoKey
        ? 'ключ сохранён'
        : 'не задан';
      must<HTMLElement>(root, '#deepseek-key-state').textContent = state.config.hasDeepSeekKey
        ? 'ключ сохранён'
        : 'не задан';
    }
  };

  const applyItemAction = async (op: string, key: string) => {
    if (!state) {
      return;
    }
    const item =
      state.items.find((entry) => itemKey(entry) === key) ||
      historyItems.find((entry) => itemKey(entry) === key);
    if (!item) {
      return;
    }
    try {
      const result = await reviewItem(item.platform, item.id, op);
      if (result.ok) {
        const messages: Record<string, string> = {
          allow: 'Донат разрешён',
          block: 'Донат заблокирован',
          replay: 'Донат отправлен на повтор',
          retry: 'Отправлен на перепроверку',
        };
        toast(root, messages[op] ?? 'Готово');
        await load(true);
      } else {
        toast(root, 'Операция недоступна для этого статуса', 'bad');
      }
    } catch {
      toast(root, 'Не удалось выполнить операцию', 'bad');
    }
  };

  const openSettings = () => {
    const current = state;
    if (!current) {
      return;
    }
    settingsOpen = true;
    modal.hidden = false;
    must<HTMLInputElement>(root, '#go-key').value = '';
    must<HTMLInputElement>(root, '#deepseek-key').value = '';
    must<HTMLInputElement>(root, '#clear-go').checked = false;
    must<HTMLInputElement>(root, '#clear-deepseek').checked = false;
    const goModel = must<HTMLSelectElement>(root, '#go-model');
    if (![...goModel.options].some((option) => option.value === current.config.goModel)) {
      goModel.add(new Option(current.config.goModel, current.config.goModel));
    }
    goModel.value = current.config.goModel;
    const goReasoning = must<HTMLSelectElement>(root, '#go-reasoning');
    const reasoning = current.config.goReasoning || 'medium';
    if (![...goReasoning.options].some((option) => option.value === reasoning)) {
      goReasoning.add(new Option(reasoning, reasoning));
    }
    goReasoning.value = reasoning;
    must<HTMLInputElement>(root, '#deepseek-model').value = current.config.deepSeekModel;
    must<HTMLInputElement>(root, '#timeout').value = String(current.config.timeoutSeconds);
    must<HTMLInputElement>(root, '#display-seconds').value = String(current.config.displaySeconds);
    must<HTMLTextAreaElement>(root, '#rules').value = current.config.rules;
    must<HTMLInputElement>(root, '#paused').checked = current.config.paused;
    must<HTMLInputElement>(root, '#outputs-ready').checked = current.config.outputsReady;
    const goKey = must<HTMLInputElement>(root, '#go-key');
    const deepseekKey = must<HTMLInputElement>(root, '#deepseek-key');
    goKey.placeholder = current.config.hasGoKey
      ? 'Ключ сохранён — оставь пустым'
      : 'Ключ OpenCode Go';
    deepseekKey.placeholder = current.config.hasDeepSeekKey
      ? 'Ключ сохранён — оставь пустым'
      : 'Ключ DeepSeek';
    render();
  };

  const closeSettings = () => {
    settingsOpen = false;
    modal.hidden = true;
  };

  const collect = (): ConfigPayload => {
    const goKey = must<HTMLInputElement>(root, '#go-key').value.trim();
    const deepSeekKey = must<HTMLInputElement>(root, '#deepseek-key').value.trim();
    return {
      clearDeepSeekKey: must<HTMLInputElement>(root, '#clear-deepseek').checked,
      clearGoKey: must<HTMLInputElement>(root, '#clear-go').checked,
      deepSeekModel: must<HTMLInputElement>(root, '#deepseek-model').value.trim(),
      displaySeconds: Number(must<HTMLInputElement>(root, '#display-seconds').value) || 15,
      goModel: must<HTMLSelectElement>(root, '#go-model').value.trim(),
      goReasoning: must<HTMLSelectElement>(root, '#go-reasoning').value,
      ...(goKey ? { goKey } : {}),
      ...(deepSeekKey ? { deepSeekKey } : {}),
      outputsReady: must<HTMLInputElement>(root, '#outputs-ready').checked,
      paused: must<HTMLInputElement>(root, '#paused').checked,
      rules: must<HTMLTextAreaElement>(root, '#rules').value,
      timeoutSeconds: Number(must<HTMLInputElement>(root, '#timeout').value) || 10,
    };
  };

  const save = async (quiet = false): Promise<boolean> => {
    const button = must<HTMLButtonElement>(root, '#save-settings');
    button.disabled = true;
    try {
      setState(await saveConfig(collect()));
      if (!quiet) {
        toast(root, 'Настройки сохранены');
      }
      return true;
    } catch {
      toast(root, 'Не удалось сохранить настройки', 'bad');
      return false;
    } finally {
      button.disabled = false;
    }
  };

  const runTest = async (provider: 'OpenCode Go' | 'DeepSeek API') => {
    const target = must<HTMLElement>(
      root,
      provider === 'OpenCode Go' ? '#go-test' : '#deepseek-test',
    );
    target.textContent = 'Проверяю…';
    const saved = await save(true);
    if (!saved) {
      target.textContent = 'Сначала сохрани настройки';
      return;
    }
    try {
      const result = await testProvider(provider);
      target.textContent = result.ok
        ? `Ответ: ${result.decision} · ${result.reason || ''}`
        : `Ошибка: ${result.error || 'unknown'}`;
    } catch {
      target.textContent = 'Провайдер недоступен';
    }
  };

  filters.addEventListener(
    'wheel',
    (event) => {
      if (filters.scrollWidth <= filters.clientWidth) {
        return;
      }
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }
      filters.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false },
  );

  filters.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-filter]');
    if (!button) {
      return;
    }
    filter = button.dataset.filter || 'all';
    renderFilters();
    if (filter === 'history') {
      loadHistory().catch(() => undefined);
    }
    renderList();
  });

  search.addEventListener('input', renderList);

  list.addEventListener('click', (event) => {
    const target = event.target as Element;
    const action = target.closest<HTMLButtonElement>('[data-op]');
    const article = target.closest<HTMLElement>('[data-key]');
    if (action && article) {
      event.stopPropagation();
      applyItemAction(action.dataset.op || '', article.dataset.key || '').catch(() => undefined);
      return;
    }
    if (article) {
      selected = article.dataset.key || '';
      renderList();
      renderDetail();
    }
  });

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const article = (event.target as Element).closest<HTMLElement>('[data-key]');
    if (!article) {
      return;
    }
    event.preventDefault();
    selected = article.dataset.key || '';
    renderList();
    renderDetail();
  });

  detail.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('#close-detail')) {
      selected = '';
      renderList();
      renderDetail();
      return;
    }
    const action = target.closest<HTMLButtonElement>('[data-op]');
    if (action && selected) {
      applyItemAction(action.dataset.op || '', selected).catch(() => undefined);
    }
  });

  toggle.addEventListener('click', async () => {
    if (!state) {
      return;
    }
    try {
      const result = await control(state.config.paused ? 'resume' : 'pause');
      if (result.ok) {
        toast(root, state.config.paused ? 'Вывод продолжен' : 'Вывод поставлен на паузу');
        await load(true);
      } else {
        toast(root, 'Не удалось изменить состояние', 'bad');
      }
    } catch {
      toast(root, 'Не удалось изменить состояние', 'bad');
    }
  });

  must<HTMLButtonElement>(root, '#restart-engine').addEventListener('click', async () => {
    try {
      const result = await control('restart');
      if (result.ok) {
        toast(root, 'Движок перезапущен');
        window.setTimeout(() => {
          load(true).catch(() => undefined);
        }, 700);
      } else {
        toast(root, 'Перезапуск не удался', 'bad');
      }
    } catch {
      toast(root, 'Перезапуск не удался', 'bad');
    }
  });

  must<HTMLButtonElement>(root, '#import-history').addEventListener('click', async () => {
    const button = must<HTMLButtonElement>(root, '#import-history');
    button.disabled = true;
    button.textContent = 'Загружаю…';
    try {
      const result = await importHistory();
      if (result.ok) {
        filter = 'history';
        await load(true);
        await loadHistory();
        renderFilters();
        renderList();
        renderDetail();
        toast(root, `История: добавлено ${result.imported ?? 0}, уже было ${result.skipped ?? 0}`);
      } else {
        const labels: Record<string, string> = {
          http_401: 'нужна повторная авторизация DonationAlerts',
          http_403: 'нет доступа к истории',
          http_429: 'слишком много запросов, попробуй позже',
          missing_token: 'сначала авторизуй DonationAlerts',
        };
        toast(root, labels[result.error ?? ''] ?? 'Не удалось загрузить историю', 'bad');
      }
    } catch {
      toast(root, 'Не удалось загрузить историю', 'bad');
    } finally {
      button.disabled = false;
      button.textContent = 'Загрузить историю';
    }
  });

  must<HTMLButtonElement>(root, '#refresh').addEventListener('click', () => {
    load().catch(() => undefined);
  });

  must<HTMLButtonElement>(root, '#open-settings').addEventListener('click', openSettings);
  must<HTMLButtonElement>(root, '#close-settings').addEventListener('click', closeSettings);
  must<HTMLButtonElement>(root, '#cancel-settings').addEventListener('click', closeSettings);
  must<HTMLButtonElement>(root, '#test-go').addEventListener('click', () => {
    runTest('OpenCode Go').catch(() => undefined);
  });
  must<HTMLButtonElement>(root, '#test-deepseek').addEventListener('click', () => {
    runTest('DeepSeek API').catch(() => undefined);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save().catch(() => undefined);
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeSettings();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (settingsOpen) {
        closeSettings();
      } else if (selected) {
        selected = '';
        renderList();
        renderDetail();
      }
    }
  });

  load().catch(() => undefined);
  window.setInterval(() => {
    if (!document.hidden) {
      load(true).catch(() => undefined);
    }
  }, 1500);
}
