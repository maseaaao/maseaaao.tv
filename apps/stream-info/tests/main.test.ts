import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../package.json';
import type { Dock } from '../src/render';
import { parseRecord, required, textValue } from './assertions';
import { mockStreamerbot } from './mocks/streamerbot-client';

const clientMock = vi.hoisted(
  (): { current?: typeof import('./mocks/streamerbot-client') } => ({}),
);
vi.mock('@streamerbot/client', async () => {
  const module = await import('./mocks/streamerbot-client');
  clientMock.current = module;
  return module;
});

// Один микротаск-хоп: reactive-выкладка запускается из queueMicrotask, фокус и
// обсерверы скролла планируются там же, поэтому один хоп — готовый checkpoint.
const nextTick = (): Promise<void> => new Promise<void>((resolve) => queueMicrotask(resolve));

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise((resolve) => window.setTimeout(resolve, 0));
  await nextTick();
};

type Field = HTMLInputElement | HTMLTextAreaElement;
let dock: Dock | undefined;

// Deliberately small helpers: native labels/aria-label and explicit roles, not a
// second accessibility-name implementation. All queries target the mounted DOM.
function queryField(name: string | RegExp): Field | null {
  const matches = (value: string) =>
    typeof name === 'string' ? value.trim() === name : name.test(value.trim());
  const fields = Array.from(document.querySelectorAll<Field>('input, textarea'));
  return (
    fields.find(
      (field) =>
        matches(field.getAttribute('aria-label') ?? '') ||
        Array.from(field.labels ?? []).some((label) => matches(label.textContent ?? '')),
    ) ?? null
  );
}
function field(name: string | RegExp): Field {
  return required(queryField(name));
}
function buttons(name: string | RegExp): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((button) => {
    const label = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
    return typeof name === 'string' ? label === name : name.test(label);
  });
}
function button(name: string | RegExp, index = 0): HTMLButtonElement {
  const value = buttons(name)[index];
  if (!value)
    throw new Error(
      `Button ${name} is not rendered. Available: ${Array.from(document.querySelectorAll('button'))
        .map((b) => b.getAttribute('aria-label') ?? b.textContent)
        .join(', ')}`,
    );
  return value;
}
function roleText(role: 'status' | 'alert', text: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`)).find(
      (element) => element.textContent?.trim() === text,
    ) ?? null
  );
}
function options(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'));
}
function categoryOption(index = 0): HTMLButtonElement {
  return required(options()[index]);
}
function optionNamed(name: string): HTMLButtonElement | null {
  return options().find((value) => value.textContent?.trim() === name) ?? null;
}
async function click(name: string | RegExp, index = 0): Promise<void> {
  button(name, index).click();
  await nextTick();
}
async function setValue(name: string | RegExp, value: string): Promise<Field> {
  const input = field(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  return input;
}
async function boot(options?: { demo?: boolean }): Promise<void> {
  // resetModules can leave the previous app's callbacks in place, so each boot
  // imports a fresh copy and disposes the old dock explicitly.
  dock?.dispose();
  dock = undefined;
  document.body.innerHTML = '<div id="app"></div>';
  const { initDock } = await import('../src/render');
  dock = initDock(required(document.querySelector('#app')), options);
  await flush();
  await flush();
}

function commands(): string[] {
  return mockStreamerbot.actionCalls.map((call) => textValue(call.args.command));
}

interface ControlledAction {
  args: Record<string, unknown>;
  acknowledge(): void;
  rejectAck(error: Error): void;
  respond(envelope: Record<string, unknown>): void;
}

// Keep the existing client mock, but separate transport ACK from CodeEvent.
// Install before mounting so each client retains its own registered event handler.
async function controlActions(
  command: 'saveTemplates' | 'updateTwitch' | 'runPreset',
): Promise<ControlledAction[]> {
  await import('@streamerbot/client');
  const { StreamerbotClient } = required(clientMock.current);
  type Client = InstanceType<typeof StreamerbotClient>;
  type Handler = Parameters<Client['on']>[1];
  const handlers = new WeakMap<Client, Handler>();
  // The original is deliberately rebound with .call(this), not invoked unbound.
  const originalOn = StreamerbotClient.prototype.on;
  vi.spyOn(StreamerbotClient.prototype, 'on').mockImplementation(function (
    this: Client,
    event,
    handler,
  ) {
    if (event === 'Custom.CodeEvent') handlers.set(this, handler);
    return originalOn.call(this, event, handler);
  });
  const originalAction = StreamerbotClient.prototype.doAction;
  const pending: ControlledAction[] = [];
  vi.spyOn(StreamerbotClient.prototype, 'doAction').mockImplementation(function (
    this: Client,
    action,
    args = {},
  ) {
    const controlled =
      command === 'runPreset' ? action.id === 'preset-pubg' : args.command === command;
    if (!controlled) return originalAction.call(this, action, args);
    mockStreamerbot.actionCalls.push({ id: action.id, args });
    return new Promise<void>((resolve, reject) => {
      pending.push({
        args,
        acknowledge: resolve,
        rejectAck: reject,
        respond: (envelope) =>
          required(handlers.get(this))({
            data: {
              eventName: 'stream_info_api_response',
              args: {
                apiVersion: 4,
                requestId: textValue(args.requestId),
                command: textValue(args.command),
                ok: true,
                data: {},
                error: null,
                ...envelope,
              },
            },
          }),
      });
    });
  });
  return pending;
}

function savedTemplateResponse(template: string): Record<string, unknown> {
  return {
    data: {
      templates: { twitchTemplate: template, subtitle: 'Старт', configured: true },
    },
  };
}

describe('Stream Info DOM interactions', () => {
  const open = vi.fn(() => null);
  const writeText = vi.fn(() => Promise.resolve());
  let timeoutSpy: MockInstance<typeof window.setTimeout>;
  let intervalSpy: MockInstance<typeof window.setInterval>;
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    // resetModules does not dispose callbacks belonging to the previous app.
    // Track real timers as well as the fake timers used by individual tests.
    timeoutSpy = vi.spyOn(window, 'setTimeout');
    intervalSpy = vi.spyOn(window, 'setInterval');
    vi.resetModules();
    mockStreamerbot.reset();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('open', open);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    open.mockClear();
    writeText.mockClear();
  });

  afterEach(() => {
    dock?.dispose();
    dock = undefined;
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const result of timeoutSpy.mock.results) {
      if (result.type === 'return') window.clearTimeout(result.value);
    }
    for (const result of intervalSpy.mock.results) {
      if (result.type === 'return') window.clearInterval(result.value);
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('does not replace a healthy socket when connection settings are unchanged', async () => {
    await boot();
    const before = mockStreamerbot.instances.length;
    await click('Настройки');
    await click('Сохранить подключение');
    await flush();
    expect(mockStreamerbot.instances).toHaveLength(before);
    expect(roleText('status', 'Streamer.bot подключён')).not.toBeNull();
  });

  it.each(['onConnect', 'onDisconnect', 'onError'] as const)(
    'ignores retired client %s without disturbing a new pending search',
    async (hook) => {
      await boot();
      vi.useFakeTimers();
      const old = required(mockStreamerbot.instances[0]);
      await setValue('Категория', 'Adventure');
      await click('Настройки');
      await setValue('Порт', '8081');
      await click('Сохранить подключение');
      await vi.advanceTimersByTimeAsync(250);
      mockStreamerbot.deferSearch = true;
      await setValue('Категория', 'Adventure new');
      await vi.advanceTimersByTimeAsync(250);
      old.options[hook]?.(new Error('old password error'));
      await vi.advanceTimersByTimeAsync(0);
      expect(roleText('status', 'Streamer.bot подключён')).not.toBeNull();
      required(mockStreamerbot.pendingSearches[0]).reply({
        data: { results: [{ id: 'fresh', name: 'Adventure new' }] },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(categoryOption().textContent?.trim()).toBe('Adventure new');
      expect(document.querySelector('.auth-panel')).toBeNull();
    },
  );

  it.each(['before', 'after'])(
    'ignores retired getState completion %s replacement connection',
    async (timing) => {
      await boot();
      vi.useFakeTimers();
      const old = required(mockStreamerbot.instances[0]);
      const original = old.doAction.bind(old);
      let finish: () => void = () => {
        throw new Error('Fixture callback was not installed');
      };
      vi.spyOn(old, 'doAction').mockImplementationOnce(async (action, args) => {
        await original(action, args);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
      await click('Обновить данные');
      await vi.advanceTimersByTimeAsync(0);
      let disconnected: () => void = () => {
        throw new Error('Fixture callback was not installed');
      };
      vi.spyOn(old, 'disconnect').mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            disconnected = resolve;
          }),
      );
      mockStreamerbot.state = structuredClone(mockStreamerbot.state);
      mockStreamerbot.state.twitch.accountName = 'Replacement account';
      await click('Настройки');
      await setValue('Порт', '8081');
      await click('Сохранить подключение');
      if (timing === 'before') {
        finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(roleText('status', 'Подключение…')).not.toBeNull();
        expect(document.querySelector('.notices > [role]')).toBeNull();
        expect(document.querySelector('[role="listbox"]')).toBeNull();
      }
      disconnected();
      await vi.advanceTimersByTimeAsync(0);
      await setValue('Категория', 'Adventure');
      await vi.advanceTimersByTimeAsync(250);
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.querySelector('section[aria-label="Twitch"]')?.textContent).toContain(
        'Replacement account',
      );
      expect(categoryOption().textContent?.trim()).toBe('PUBG: BATTLEGROUNDS');
      expect(document.querySelector('.notices > [role]')).toBeNull();
    },
  );

  it('invalidates callbacks before awaiting old disconnect', async () => {
    await boot();
    vi.useFakeTimers();
    const old = required(mockStreamerbot.instances[0]);
    let finish: () => void = () => {
      throw new Error('Fixture callback was not installed');
    };
    vi.spyOn(old, 'disconnect').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await click('Настройки');
    await setValue('Порт', '8081');
    await click('Сохранить подключение');
    old.options.onDisconnect?.();
    old.options.onConnect?.();
    old.options.onError?.(new Error('old password error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(roleText('status', 'Подключение…')).not.toBeNull();
    expect(document.querySelector('.auth-panel')).toBeNull();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(roleText('status', 'Streamer.bot подключён')).not.toBeNull();
  });

  it('renders a failed search envelope as retryable error, never empty', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { ok: false, error: { message: 'Search unavailable' } };
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(250);
    expect(roleText('alert', 'Search unavailable')).not.toBeNull();
    expect(roleText('status', 'Ничего не найдено')).toBeNull();
    mockStreamerbot.searchReply = {
      ok: true,
      data: { results: [{ id: 'adventure', name: 'Adventure', imageUrl: '' }] },
    };
    await click('Повторить поиск');
    await vi.advanceTimersByTimeAsync(250);
    expect(categoryOption().textContent).toContain('Adventure');
    expect(
      JSON.parse(textValue(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson)),
    ).toMatchObject({
      query: 'Adventure',
    });
  });

  it('serializes search requests and rejects stale ABA responses deterministically', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.deferSearch = true;
    const selector = 'Категория';
    await setValue(selector, 'Alpha');
    await vi.advanceTimersByTimeAsync(250);
    await setValue(selector, 'Beta');
    await vi.advanceTimersByTimeAsync(250);
    await setValue(selector, 'Alpha');
    await vi.advanceTimersByTimeAsync(250);
    expect(mockStreamerbot.pendingSearches).toHaveLength(1);
    required(mockStreamerbot.pendingSearches[0]).reply({
      data: { results: [{ id: 'old', name: 'Old Alpha' }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(optionNamed('Old Alpha')).toBeNull();
    expect(mockStreamerbot.pendingSearches).toHaveLength(2);
    expect(required(mockStreamerbot.pendingSearches[1]).payload).toEqual({ query: 'Alpha' });
    required(mockStreamerbot.pendingSearches[1]).reply({
      data: { results: [{ id: 'new', name: 'Alpha new' }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(categoryOption().textContent?.trim()).toBe('Alpha new');
  });

  it('invalidates pending search on reconnect but retains the query draft', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.deferSearch = true;
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.disconnectHook?.();
    required(mockStreamerbot.pendingSearches[0]).reply({
      data: { results: [{ id: 'stale', name: 'Adventure stale' }] },
    });
    await click('Настройки');
    await click('Сохранить подключение');
    await vi.advanceTimersByTimeAsync(250);
    expect(queryField('Категория')?.value).toBe('Adventure');
    expect(optionNamed('Adventure stale')).toBeNull();
    expect(mockStreamerbot.pendingSearches).toHaveLength(2);
    required(mockStreamerbot.pendingSearches[1]).reply({
      data: { results: [{ id: 'fresh', name: 'Adventure fresh' }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(categoryOption().textContent?.trim()).toBe('Adventure fresh');
  });

  it('retains category input identity, caret and composition through background refresh', async () => {
    await boot();
    vi.useFakeTimers();
    const selector = 'Категория';
    const input = required(queryField(selector));
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await nextTick();
    await setValue(selector, '冒険');
    input.setSelectionRange(1, 1);
    await click('Обновить данные');
    await vi.advanceTimersByTimeAsync(500);
    expect(queryField(selector)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(commands().filter((command) => command === 'searchTwitchCategories')).toHaveLength(0);
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await nextTick();
    await vi.advanceTimersByTimeAsync(250);
    expect(commands().filter((command) => command === 'searchTwitchCategories')).toHaveLength(1);
    await click('Обновить данные');
    await vi.advanceTimersByTimeAsync(0);
    expect(queryField(selector)).toBe(input);
    expect(input.value).toBe('冒険');
  });

  it('preserves a focused category button by ID through refresh', async () => {
    await boot();
    vi.useFakeTimers();
    await setValue('Категория', 'PUBG');
    await vi.advanceTimersByTimeAsync(250);
    categoryOption().focus();
    await click('Обновить данные');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(optionNamed('PUBG: BATTLEGROUNDS'));
  });

  it('shows ranked batches of twenty and merges cursor pages beyond one hundred candidates', async () => {
    await boot();
    vi.useFakeTimers();
    const results = Array.from({ length: 100 }, (_, index) => ({
      id: `game-${index}`,
      name: `Adventure ${index}`,
      imageUrl: '',
    }));
    mockStreamerbot.searchReply = {
      data: { results, cursor: 'page-two', hasMore: true, partial: false },
    };
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(250);
    expect(options()).toHaveLength(20);
    for (let index = 0; index < 4; index++) await click('Показать ещё');
    expect(options()).toHaveLength(100);
    mockStreamerbot.searchReply = {
      data: {
        results: [
          results[0],
          ...Array.from({ length: 30 }, (_, index) => ({
            id: `next-${index}`,
            name: `Adventure next ${index}`,
          })),
        ],
        cursor: null,
        hasMore: false,
        partial: false,
      },
    };
    const list = required(document.querySelector<HTMLElement>('[role="listbox"]'));
    list.scrollTop = 77;
    categoryOption(50).focus();
    await click('Показать ещё');
    expect(options()).toHaveLength(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(options()).toHaveLength(120);
    expect(document.querySelector<HTMLElement>('[role="listbox"]')?.scrollTop).toBe(77);
    expect(document.activeElement).toBe(optionNamed('Adventure 50'));
    expect(JSON.parse(textValue(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson))).toEqual({
      query: 'Adventure',
      cursor: 'page-two',
    });
    await click('Показать ещё');
    expect(options()).toHaveLength(130);
    expect(buttons('Показать ещё')[0] ?? null).toBeNull();
  });

  it('shows partial warnings separately from errors and does not call a continuable page empty', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = {
      data: {
        results: [],
        cursor: 'continue',
        hasMore: true,
        partial: true,
        warnings: ['Some sources unavailable'],
      },
    };
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('.category-search-warning')?.textContent).toContain(
      'Some sources unavailable',
    );
    expect(roleText('status', 'Результатов: 0')).not.toBeNull();
    expect(roleText('status', 'Ничего не найдено')).toBeNull();
    expect(button('Показать ещё').disabled).toBe(false);
    mockStreamerbot.searchReply = { ok: false, error: { message: 'Page failed' } };
    await click('Показать ещё');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.category-search-status')?.textContent).toContain('Page failed');
    mockStreamerbot.searchReply = {
      data: {
        results: [{ id: 'found', name: 'Adventure' }],
        cursor: null,
        hasMore: false,
        partial: false,
      },
    };
    await click('Повторить поиск');
    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(textValue(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson))).toEqual({
      query: 'Adventure',
      cursor: 'continue',
    });
    expect(categoryOption().textContent?.trim()).toBe('Adventure');
  });

  it('supports accessible keyboard selection without guessing the first result', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = {
      data: {
        results: [
          { id: 'one', name: 'Adventure one' },
          { id: 'two', name: 'Adventure two' },
        ],
      },
    };
    const input = (await setValue('Категория', 'Adventure')) as HTMLInputElement;
    input.focus();
    await vi.advanceTimersByTimeAsync(250);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.getElementById(required(input.getAttribute('aria-controls')))?.getAttribute('role'),
    ).toBe('listbox');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(input.value).toBe('Adventure');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await nextTick();
    const active = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(required(active))?.textContent?.trim()).toBe('Adventure two');
    await click('Обновить данные');
    await vi.advanceTimersByTimeAsync(0);
    expect(input.getAttribute('aria-activedescendant')).toBe(active);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(input.value).toBe('');
    expect(document.querySelector('.selected-category')?.textContent).toContain('Adventure one');
    expect(button('Применить изменения').disabled).toBe(false);
  });

  it('scrolls the keyboard-active category into view after rendering', async () => {
    await boot();
    vi.useFakeTimers();
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    try {
      mockStreamerbot.searchReply = {
        data: {
          results: Array.from({ length: 20 }, (_, i) => ({
            id: `item-${i}`,
            name: `Adventure ${i}`,
          })),
        },
      };
      const input = await setValue('Категория', 'Adventure');
      await vi.advanceTimersByTimeAsync(250);
      for (let i = 0; i < 15; i++) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await nextTick();
      }
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
      expect(scroll.mock.contexts.at(-1)).toBe(
        document.getElementById(required(input.getAttribute('aria-activedescendant'))),
      );
      expect(document.activeElement).toBe(input);
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('transfers, traps and returns settings focus with an inert background', async () => {
    await boot();
    const opener = button('Настройки');
    opener.focus();
    await click('Настройки');
    const dialog = required(document.querySelector<HTMLElement>('[role="dialog"]'));
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(Boolean(document.querySelector('main')?.closest('[inert]'))).toBe(true);
    button('Сохранить подключение').focus();
    button('Сохранить подключение').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(button('Закрыть'));
    button('Закрыть').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(button('Сохранить подключение'));
    button('Сохранить подключение').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await nextTick();
    // Dialog focus restoration is scheduled after its unmount patch.
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('Настройки'));
    expect(Boolean(document.querySelector('main')?.closest('[inert]'))).toBe(false);
  });

  it('preserves focus on a dialog action button during a background full render', async () => {
    await boot();
    await click('Настройки');
    const save = button('Сохранить подключение');
    save.focus();
    expect(document.activeElement).toBe(save);
    await click('Обновить данные');
    await flush();
    expect(document.activeElement).toBe(button('Сохранить подключение'));
  });

  it('returns focus to category query input instead of BODY when choosing a category', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [{ id: 'pubg', name: 'PUBG' }] } };
    await setValue('Категория', 'PUBG');
    await vi.advanceTimersByTimeAsync(250);
    categoryOption().click();
    await nextTick();
    expect(document.activeElement).toBe(queryField('Категория'));
  });

  it('retains load-more focus while fetching the next page', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = {
      data: { results: [{ id: 'one', name: 'Adventure one' }], cursor: 'next', hasMore: true },
    };
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.deferSearch = true;
    button('Показать ещё').focus();
    await click('Показать ещё');
    expect(document.activeElement).toBe(button('Показать ещё'));
    expect(button('Показать ещё').disabled).toBe(false);
    expect(button('Показать ещё').getAttribute('aria-disabled')).toBe('true');
    await click('Показать ещё');
    expect(mockStreamerbot.pendingSearches).toHaveLength(1);
    required(mockStreamerbot.pendingSearches[0]).reply({
      data: { results: [{ id: 'two', name: 'Adventure two' }], cursor: 'third', hasMore: true },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(button('Показать ещё'));
    expect(button('Показать ещё').getAttribute('aria-disabled')).toBe('false');
    expect(mockStreamerbot.pendingSearches).toHaveLength(1);
  });

  it('renders old results-only replies including a genuine empty result', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [] } };
    await setValue('Категория', 'Puzzle');
    await vi.advanceTimersByTimeAsync(250);
    expect(roleText('status', 'Ничего не найдено')).not.toBeNull();
    expect(buttons('Повторить поиск')[0] ?? null).toBeNull();
    mockStreamerbot.searchReply = { data: { results: [{ id: 'puzzle', name: 'Puzzle' }] } };
    await setValue('Категория', 'Puzzles');
    await vi.advanceTimersByTimeAsync(250);
    expect(categoryOption().textContent?.trim()).toBe('Puzzle');
    expect(buttons('Показать ещё')[0] ?? null).toBeNull();
  });

  it('keeps candidates after a continuation failure and retries only that cursor', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = {
      data: { results: [{ id: 'sim', name: 'Simulator' }], cursor: 'next', hasMore: true },
    };
    await setValue('Категория', 'Simulator');
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.searchReply = { ok: false, error: { message: 'Temporarily unavailable' } };
    await click('Показать ещё');
    await vi.advanceTimersByTimeAsync(0);
    expect(categoryOption().textContent?.trim()).toBe('Simulator');
    expect(document.querySelector('.category-search-status')?.textContent).toContain(
      'Temporarily unavailable',
    );
    mockStreamerbot.searchReply = {
      data: {
        results: [
          { id: 'sim', name: 'Simulator' },
          { id: 'sim2', name: 'Simulator two' },
        ],
        cursor: null,
        hasMore: false,
      },
    };
    await click('Повторить поиск');
    await vi.advanceTimersByTimeAsync(0);
    expect(options()).toHaveLength(2);
    expect(JSON.parse(textValue(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson))).toEqual({
      query: 'Simulator',
      cursor: 'next',
    });
  });

  it('escapes category names and image attributes and falls back without inline handlers', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = {
      data: {
        results: [
          {
            id: 'safe',
            name: '<img src=x onerror="unsafe()">',
            imageUrl: 'https://example.invalid/cover" onerror="unsafe()',
          },
        ],
      },
    };
    await setValue('Категория', 'Safe');
    await vi.advanceTimersByTimeAsync(250);
    const option = categoryOption();
    expect(option.querySelectorAll('img')).toHaveLength(1);
    expect(option.querySelector('[onerror]')).toBeNull();
    expect(option.querySelector('strong')?.textContent).toBe('<img src=x onerror="unsafe()">');
    required(option.querySelector('img')).dispatchEvent(new Event('error'));
    await nextTick();
    // Обложка удаляет не загрузившуюся картинку вместо устаревшего CSS-скрытия.
    expect(option.querySelector('img')).toBeNull();
    const fallback = required(option.querySelector('svg.icon-defaultCategory'));
    expect(getComputedStyle(fallback).display).not.toBe('none');
    categoryOption().click();
    await nextTick();
    expect(document.querySelector('.selected-category')?.textContent).toContain(
      '<img src=x onerror="unsafe()">',
    );
  });

  it.each([{ ok: false }, { ok: 'false' }, { data: null }, { data: { results: 'invalid' } }])(
    'rejects malformed or failing search replies %j',
    async (envelope) => {
      await boot();
      vi.useFakeTimers();
      mockStreamerbot.searchReply = envelope;
      await setValue('Категория', 'Puzzle');
      await vi.advanceTimersByTimeAsync(250);
      expect(buttons('Повторить поиск')[0] ?? null).not.toBeNull();
      expect(options()[0] ?? null).toBeNull();
    },
  );

  it('retains earlier partial warnings after a successful continuation page', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = {
      data: {
        results: [{ id: 'one', name: 'Adventure one' }],
        cursor: 'next',
        hasMore: true,
        partial: true,
        warnings: ['One source unavailable'],
      },
    };
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.searchReply = {
      data: {
        results: [{ id: 'two', name: 'Adventure two' }],
        cursor: null,
        hasMore: false,
        partial: false,
      },
    };
    await click('Показать ещё');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.category-search-warning')?.textContent).toContain(
      'One source unavailable',
    );
  });

  it.each(['twitch'] as const)(
    'requires explicit selection for unresolved %s text while retaining current category',
    async () => {
      await boot();
      const selector = 'Категория';
      await setValue(selector, 'Unresolved');
      expect(document.querySelector('.selected-category')).not.toBeNull();
      expect(button('Применить изменения').disabled).toBe(true);
      await click('Применить изменения');
      expect(commands()).not.toContain('saveTemplates');
      expect(button('Применить изменения').disabled).toBe(true);
      await setValue(selector, '');
      expect(button('Применить изменения').disabled).toBe(false);
    },
  );

  it('keeps search candidates and draft when closing settings', async () => {
    await boot();
    vi.useFakeTimers();
    await setValue('Категория', 'PUBG');
    await vi.advanceTimersByTimeAsync(250);
    await click('Настройки');
    await click('Закрыть');
    expect(categoryOption().textContent).toContain('PUBG');
    expect(queryField('Категория')?.value).toBe('PUBG');
  });

  it('always shows Twitch even when an old setting disabled it', async () => {
    localStorage.setItem(
      'change-info-streamer-bot.settings.v1',
      JSON.stringify({ twitchEnabled: false }),
    );
    await boot();
    expect(document.querySelector('[role="switch"]')).toBeNull();
    expect(document.querySelector('.subtitle-panel, .mode-toggle')).toBeNull();
    expect(queryField('Название')).not.toBeNull();
    expect(queryField('Шаблон Twitch')).not.toBeNull();
    expect(button('Применить изменения').disabled).toBe(false);
    await setValue('Название', 'Updated');
    await setValue('Шаблон Twitch', 'New %subtitle%');
    await click('Применить изменения');
    await flush();
    await flush();
    const update = mockStreamerbot.actionCalls.find((call) => call.args.command === 'updateTwitch');
    expect(JSON.parse(textValue(update?.args.payloadJson))).toMatchObject({ title: 'New Updated' });
    expect(mockStreamerbot.state.templates.twitchTemplate).toBe('New %subtitle%');
  });

  it('applies a template-only edit and rejects repeated title tokens', async () => {
    await boot();
    await setValue('Шаблон Twitch', '%subtitle% / %subtitle%');
    expect(button('Применить изменения').disabled).toBe(true);
    await setValue('Шаблон Twitch', 'Only %subtitle%');
    expect(button('Применить изменения').disabled).toBe(false);
    await click('Применить изменения');
    await flush();
    await flush();
    const update = mockStreamerbot.actionCalls.find((call) => call.args.command === 'updateTwitch');
    expect(JSON.parse(textValue(update?.args.payloadJson))).toMatchObject({ title: 'Only Старт' });
    expect(mockStreamerbot.state.templates.twitchTemplate).toBe('Only %subtitle%');
    expect(document.querySelector('.template-dirty')?.textContent).toBe('');
  });

  it('uses availability as well as selection and gives Twitch the correct unavailable reason', async () => {
    mockStreamerbot.state.twitch.connected = false;
    await boot();
    expect(button('Применить изменения').disabled).toBe(true);
    expect(button('Применить изменения').disabled).toBe(true);
    expect(required(document.querySelectorAll('.inline-editor')[0]).textContent).toContain(
      'Аккаунт не подключён',
    );
  });

  it('renders stream editors directly on the main page without editor modals', async () => {
    await boot();
    expect(buttons('Изменить всё')[0] ?? null).toBeNull();
    expect(buttons('Изменить Twitch')[0] ?? null).toBeNull();
    expect(document.querySelectorAll('.inline-editor')).toHaveLength(1);
    expect(buttons('По шаблону')).toHaveLength(0);
    await setValue('Название', 'Inline Twitch title');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(queryField('Название')?.value).toBe('Inline Twitch title');
    await click('Обновить данные');
    await flush();
    expect(queryField('Название')?.value).toBe('Inline Twitch title');
    await click('Настройки');
    await click('Закрыть');
    expect(queryField('Название')?.value).toBe('Inline Twitch title');
  });

  it('identifies connection saving and unsaved templates in Russian', async () => {
    const label = 'Сохранить подключение';
    const dirty = 'Есть несохранённые изменения шаблонов';
    await boot();
    await click('Настройки');
    expect(button('Сохранить подключение').textContent).toBe(label);
    await click('Закрыть');
    expect(document.querySelector('.template-dirty')?.textContent).toBe('');
    const original = mockStreamerbot.state.templates.twitchTemplate;
    await setValue('Шаблон Twitch', 'Draft %subtitle%');
    expect(document.querySelector('.template-dirty')?.textContent).toBe(dirty);
    await setValue('Шаблон Twitch', original);
    expect(document.querySelector('.template-dirty')?.textContent).toBe('');
  });

  it('saves connection independently while preserving unsaved templates', async () => {
    await boot();
    await setValue('Шаблон Twitch', 'Draft %subtitle%');
    await click('Настройки');
    await setValue('Хост', 'localhost');
    await click('Сохранить подключение');
    await flush();
    expect(commands()).not.toContain('saveTemplates');
    await click('Настройки');
    expect(queryField('Шаблон Twitch')?.value).toBe('Draft %subtitle%');
    expect(document.querySelector('.template-dirty')?.textContent).toContain('несохранённые');
    if (document.querySelector('[role="dialog"]')) await click('Закрыть');
    await click('Применить изменения');
    await flush();
    expect(document.querySelector('.template-dirty')?.textContent).toBe('');
  });

  it('recovers unsaved template edits from this browser tab after reload', async () => {
    await boot();
    await setValue('Шаблон Twitch', 'Recovered %subtitle%');
    expect(sessionStorage.getItem('change-info-streamer-bot.template-draft.v1')).toContain(
      'Recovered %subtitle%',
    );

    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    await boot();
    await click('Настройки');
    await click('Закрыть');
    expect(queryField('Шаблон Twitch')?.value).toBe('Recovered %subtitle%');
    expect(document.querySelector('.template-dirty')?.textContent).toContain('несохранённые');
    await click('Применить изменения');
    await flush();
    expect(sessionStorage.getItem('change-info-streamer-bot.template-draft.v1')).toBeNull();
  });

  it.each(['ack-first', 'event-first'] as const)(
    'requires both independent template-save completions (%s)',
    async (order) => {
      vi.useFakeTimers();
      const pending = await controlActions('saveTemplates');
      await boot();
      await setValue('Шаблон Twitch', 'Saved %subtitle%');
      await click('Применить изменения');
      const request = required(pending[0]);
      expect(parseRecord(textValue(request.args.payloadJson))).toMatchObject({
        twitchTemplate: 'Saved %subtitle%',
      });
      const before = localStorage.getItem('change-info-streamer-bot.settings.v1');
      if (order === 'ack-first') request.acknowledge();
      else request.respond(savedTemplateResponse('Saved %subtitle%'));
      await flush();
      expect(button('Применить изменения').disabled).toBe(true);
      expect(roleText('status', 'Есть несохранённые изменения шаблонов')).not.toBeNull();
      expect(document.querySelector('.notices > [role]')).toBeNull();
      expect(localStorage.getItem('change-info-streamer-bot.settings.v1')).toBe(before);
      mockStreamerbot.state.templates.twitchTemplate = 'Saved %subtitle%';
      if (order === 'ack-first') request.respond(savedTemplateResponse('Saved %subtitle%'));
      else request.acknowledge();
      await flush();
      expect(button('Применить изменения').disabled).toBe(false);
      expect(document.querySelector('.template-dirty')?.textContent).toBe('');
      expect(
        parseRecord(required(localStorage.getItem('change-info-streamer-bot.settings.v1')))
          .twitchTemplate,
      ).toBe('Saved %subtitle%');
      await flush();
      expect(document.querySelector('.save-status')?.textContent).toBe('Изменения применены');
    },
  );

  it.each([false, true])(
    'rejects a failed ACK even if CodeEvent already arrived: %s',
    async (eventFirst) => {
      vi.useFakeTimers();
      const pending = await controlActions('saveTemplates');
      await boot();
      await setValue('Шаблон Twitch', 'Rejected %subtitle%');
      await click('Применить изменения');
      const request = required(pending[0]);
      const before = localStorage.getItem('change-info-streamer-bot.settings.v1');
      if (eventFirst) request.respond(savedTemplateResponse('Rejected %subtitle%'));
      request.rejectAck(new Error('ACK rejected'));
      await flush();
      expect(button('Применить изменения').disabled).toBe(false);
      expect(roleText('status', 'Есть несохранённые изменения шаблонов')).not.toBeNull();
      expect(document.querySelector('.notices > [role="alert"]')?.textContent).toContain(
        'ACK rejected',
      );
      const notice = required(document.querySelector('.notices > [role="alert"]'));
      expect(notice.closest('[inert]')).toBeNull();
      expect(document.querySelector('.dock-scroll')?.contains(notice)).toBe(true);
      request.respond(savedTemplateResponse('Rejected %subtitle%'));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(localStorage.getItem('change-info-streamer-bot.settings.v1')).toBe(before);
      expect(field('Шаблон Twitch').value).toBe('Rejected %subtitle%');
      expect(document.querySelectorAll('.notices > [role]')).toHaveLength(1);
    },
  );

  it.each([false, true])(
    'bounds a missing CodeEvent to 15 seconds with ACK completed: %s',
    async (acknowledged) => {
      vi.useFakeTimers();
      const pending = await controlActions('saveTemplates');
      await boot();
      await setValue('Шаблон Twitch', 'Timed out %subtitle%');
      await click('Применить изменения');
      const request = required(pending[0]);
      if (acknowledged) request.acknowledge();
      await vi.advanceTimersByTimeAsync(14_999);
      expect(button('Применить изменения').disabled).toBe(true);
      expect(document.querySelector('.notices > [role]')).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(button('Применить изменения').disabled).toBe(false);
      expect(document.querySelector('.notices > [role="alert"]')?.textContent).toContain(
        '15 секунд',
      );
      expect(roleText('status', 'Есть несохранённые изменения шаблонов')).not.toBeNull();
      const before = localStorage.getItem('change-info-streamer-bot.settings.v1');
      request.respond(savedTemplateResponse('Timed out %subtitle%'));
      request.acknowledge();
      await flush();
      expect(localStorage.getItem('change-info-streamer-bot.settings.v1')).toBe(before);
      expect(document.querySelectorAll('.notices > [role]')).toHaveLength(1);
      expect(field('Шаблон Twitch').value).toBe('Timed out %subtitle%');
    },
  );

  it('times out a missing ACK after CodeEvent and isolates a late ACK from retry', async () => {
    vi.useFakeTimers();
    const pending = await controlActions('saveTemplates');
    await boot();
    await setValue('Шаблон Twitch', 'First %subtitle%');
    await click('Применить изменения');
    const first = required(pending[0]);
    const before = localStorage.getItem('change-info-streamer-bot.settings.v1');
    first.respond(savedTemplateResponse('First %subtitle%'));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(button('Применить изменения').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(button('Применить изменения').disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('15 секунд');
    expect(localStorage.getItem('change-info-streamer-bot.settings.v1')).toBe(before);
    await setValue('Шаблон Twitch', 'Retry %subtitle%');
    await click('Применить изменения');
    const retry = required(pending[1]);
    first.acknowledge();
    await flush();
    expect(button('Применить изменения').disabled).toBe(true);
    expect(localStorage.getItem('change-info-streamer-bot.settings.v1')).toBe(before);
    mockStreamerbot.state.templates.twitchTemplate = 'Retry %subtitle%';
    retry.respond(savedTemplateResponse('Retry %subtitle%'));
    retry.acknowledge();
    await flush();
    expect(button('Применить изменения').disabled).toBe(false);
    expect(
      parseRecord(required(localStorage.getItem('change-info-streamer-bot.settings.v1')))
        .twitchTemplate,
    ).toBe('Retry %subtitle%');
    expect(field('Шаблон Twitch').value).toBe('Retry %subtitle%');
  });

  async function startControlledOperation(
    command: 'saveTemplates' | 'updateTwitch' | 'runPreset',
  ): Promise<void> {
    if (command === 'saveTemplates') {
      if (document.querySelector('[role="dialog"]')) await click('Закрыть');
      await setValue('Шаблон Twitch', 'Pending %subtitle%');
      await click('Применить изменения');
    } else if (command === 'updateTwitch') {
      await setValue('Название', 'Pending title');
      await click('Применить изменения');
    } else await click('PUBG');
    await flush();
  }

  async function retireOperation(lifecycle: 'reconnect' | 'dispose'): Promise<void> {
    if (lifecycle === 'reconnect') {
      if (!document.querySelector('[role="dialog"]')) await click('Настройки');
      await setValue('Порт', '8081');
      await click('Сохранить подключение');
      await flush();
    } else {
      required(dock).dispose();
      dock = undefined;
      await boot();
    }
  }

  for (const command of ['saveTemplates', 'updateTwitch'] as const) {
    for (const lifecycle of ['reconnect', 'dispose'] as const) {
      it.each(['ack', 'event'] as const)(
        `ignores retired ${command} after ${lifecycle} while waiting for %s`,
        async (boundary) => {
          vi.useFakeTimers();
          const pending = await controlActions(command);
          await boot();
          await startControlledOperation(command);
          const retired = required(pending[0]);
          const envelope =
            command === 'saveTemplates'
              ? savedTemplateResponse('Retired %subtitle%')
              : { ok: false, data: { fields: { title: false, category: false, tags: false } } };
          if (boundary === 'ack') retired.respond(envelope);
          else retired.acknowledge();
          await flush();
          await retireOperation(lifecycle);
          await startControlledOperation(command);
          expect(pending).toHaveLength(2);
          const before = {
            html: document.body.innerHTML,
            settings: localStorage.getItem('change-info-streamer-bot.settings.v1'),
            draft: sessionStorage.getItem('change-info-streamer-bot.template-draft.v1'),
            calls: mockStreamerbot.actionCalls.length,
            timers: vi.getTimerCount(),
          };
          retired.respond(envelope);
          retired.acknowledge();
          await vi.advanceTimersByTimeAsync(1000);
          expect(document.body.innerHTML).toBe(before.html);
          expect(localStorage.getItem('change-info-streamer-bot.settings.v1')).toBe(
            before.settings,
          );
          expect(sessionStorage.getItem('change-info-streamer-bot.template-draft.v1')).toBe(
            before.draft,
          );
          expect(mockStreamerbot.actionCalls).toHaveLength(before.calls);
          expect(vi.getTimerCount()).toBe(before.timers);
          expect(
            button(command === 'saveTemplates' ? 'Применить изменения' : 'Применить изменения')
              .disabled,
          ).toBe(true);
          expect(document.querySelector('.notices > [role]')).toBeNull();
        },
      );
    }
  }

  it.each(['reconnect', 'dispose'] as const)(
    'ignores a retired preset ACK after %s without refreshing or resetting the new preset',
    async (lifecycle) => {
      vi.useFakeTimers();
      const pending = await controlActions('runPreset');
      await boot();
      await startControlledOperation('runPreset');
      const retired = required(pending[0]);
      await retireOperation(lifecycle);
      await startControlledOperation('runPreset');
      expect(pending).toHaveLength(2);
      const before = mockStreamerbot.actionCalls.length;
      const timers = vi.getTimerCount();
      retired.acknowledge();
      await vi.advanceTimersByTimeAsync(1000);
      expect(button('PUBG').disabled).toBe(true);
      expect(mockStreamerbot.actionCalls).toHaveLength(before);
      expect(vi.getTimerCount()).toBe(timers);
      expect(document.querySelector('.notices > [role]')).toBeNull();
    },
  );

  it('retains the unsaved template status when saving fails', async () => {
    await boot();
    await setValue('Шаблон Twitch', 'Draft %subtitle%');
    vi.spyOn(required(mockStreamerbot.instances[0]), 'doAction').mockRejectedValueOnce(
      new Error('Save rejected'),
    );
    if (document.querySelector('[role="dialog"]')) await click('Закрыть');
    await click('Применить изменения');
    await flush();
    expect(document.querySelector('.template-dirty')?.textContent).toContain('несохранённые');
    expect(document.querySelector('.notices > [role]')?.textContent).toContain('Save rejected');
  });

  it('runs refresh, links, preset, template and settings actions without real platform changes', async () => {
    await boot();
    const beforeRefresh = commands().filter((command) => command === 'getState').length;
    await click('Обновить данные');
    await flush();
    expect(commands().filter((command) => command === 'getState').length).toBeGreaterThan(
      beforeRefresh,
    );

    const streamLink = required(
      document.querySelector<HTMLAnchorElement>('a[aria-label="Открыть стрим"]'),
    );
    expect(streamLink.href).toBe('https://www.twitch.tv/tester');
    expect(streamLink.target).toBe('_blank');
    expect(streamLink.relList.contains('noopener')).toBe(true);
    expect(streamLink.relList.contains('noreferrer')).toBe(true);
    // Native links preserve navigation without triggering jsdom/real navigation.
    expect(open).not.toHaveBeenCalled();

    await click('PUBG');
    await flush();
    expect(mockStreamerbot.actionCalls.some((call) => call.id === 'preset-pubg')).toBe(true);

    expect(queryField('Шаблон Twitch')).not.toBeNull();
    await setValue('Название', 'Тестовый подзаголовок');
    await click('Применить изменения');
    await flush();
    await flush();
    expect(commands()).toContain('saveTemplates');
    expect(document.querySelector('.template-value, .template-token')).not.toBeNull();
    expect(commands()).toContain('updateTwitch');

    await click('Настройки');
    expect(queryField('Шаблон Twitch')).not.toBeNull();
    await setValue('Шаблон Twitch', 'Переопределённый %subtitle%');
    await setValue('Шаблон Twitch', '🔴 %subtitle%| !tg !yt !tw !donate');
    expect((queryField('Шаблон Twitch') as HTMLTextAreaElement).value).toContain('!tg');

    await setValue('Хост', 'localhost');
    await click('Сохранить подключение');
    await flush();
    expect(mockStreamerbot.connectCalls).toBeGreaterThan(1);
  });

  it('keeps Twitch results selectable when blur emits a duplicate change', async () => {
    await boot();
    vi.useFakeTimers();
    const selector = 'Категория';
    const fieldBefore = required(queryField(selector));
    await setValue(selector, 'PUBG');
    expect(queryField(selector)).toBe(fieldBefore);
    await vi.advanceTimersByTimeAsync(350);
    const option = categoryOption();
    const field = required(queryField(selector));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(option.isConnected).toBe(true);
    option.click();
    await nextTick();
    expect(queryField(selector)?.value).toBe('');
    expect(document.querySelector('.selected-category')?.textContent).toContain('PUBG');
  });

  it('invalidates in-flight Twitch results when the query is cleared', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchDelay = 200;
    const selector = 'Категория';
    await setValue(selector, 'PUBG');
    await vi.advanceTimersByTimeAsync(320);
    await setValue(selector, '');
    const clearedField = queryField(selector);
    await vi.advanceTimersByTimeAsync(220);
    expect(queryField(selector)).toBe(clearedField);
    await setValue(selector, 'Rust');
    expect(options()[0] ?? null).toBeNull();
    expect(roleText('status', 'Ищем категории…')).not.toBeNull();
    expect(roleText('status', 'Ничего не найдено')).toBeNull();
    await setValue(selector, '');
  });

  it('places the combined save action outside the subtitle and platform cards', async () => {
    await boot();
    expect(button('Применить изменения').closest('.subtitle-panel, .platform-card')).toBeNull();
    expect(button('Применить изменения').closest('.save-panel')).not.toBeNull();
    expect(button('Применить изменения').textContent).toBe('Применить изменения');
    const card = required(document.querySelector('section[aria-label="Twitch"]'));
    const savePanel = required(button('Применить изменения').closest('.save-panel'));
    expect(savePanel.parentElement).toBe(document.querySelector('.dock-shell'));
    expect(card.compareDocumentPosition(savePanel) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('announces edits immediately, confirms saving and clears confirmation on the next edit', async () => {
    await boot();
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Данные загружены');
    await setValue('Название', 'Новый эфир');
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Есть несохранённые изменения');
    await click('Применить изменения');
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Сохраняем…');
    await flush();
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Изменения применены');
    await click(/^Удалить тег[: ]/);
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Есть несохранённые изменения');
  });

  it('announces unsaved category searches without replacing the focused search input', async () => {
    await boot();
    const input = await setValue('Категория', 'PUBG');
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Есть несохранённые изменения');
    expect(queryField('Категория')).toBe(input);
  });

  it('keeps the pending status when a platform rejects the update', async () => {
    await boot();
    const client = required(mockStreamerbot.instances[0]);
    const original = client.doAction.bind(client);
    vi.spyOn(client, 'doAction').mockImplementation(async (action, args) => {
      if (args?.command === 'updateTwitch') throw new Error('Update rejected');
      return original(action, args);
    });
    await setValue('Название', 'Не сохранится');
    await click('Применить изменения');
    await flush();
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Есть несохранённые изменения');
    expect(document.querySelector('.notices')?.textContent).toContain('Update rejected');
    expect(document.querySelector('.notice--error[role="alert"] .icon-error')).not.toBeNull();
  });

  it('keeps unsent tag text and pending status after applying other fields', async () => {
    await boot();
    await setValue('Добавить тег', 'Draft');
    await click('Применить изменения');
    await flush();
    expect(queryField('Добавить тег')?.value).toBe('Draft');
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toContain('Остались несохранённые изменения');
  });

  it('renders unchanged as information', async () => {
    mockStreamerbot.state.twitch.title = '🔴 Старт| !tg';
    await boot();
    await click('Применить изменения');
    await flush();
    const info = document.querySelector('.notice--info');
    expect(info?.textContent).toContain('Нет изменений');
    expect(info?.getAttribute('role')).toBe('status');
    expect(info?.querySelector('.icon-info')).not.toBeNull();
  });

  it('shows a selected category once and invites a new search without exposing IDs', async () => {
    await boot();
    {
      const card = required(document.querySelector('section[aria-label="Twitch"]'));
      const selected = required(card.querySelector('.selected-category'));
      const search = required(queryField('Категория'));
      expect(selected.textContent).not.toContain('ID');
      expect(search.placeholder).toBe('Найти другую категорию');
      expect(search.value).toBe('');
      expect(search.placeholder).not.toContain(required(selected.textContent));
    }
    vi.useFakeTimers();
    await setValue('Категория', 'PUBG');
    await vi.advanceTimersByTimeAsync(250);
    expect(categoryOption().textContent?.trim()).toBe('PUBG: BATTLEGROUNDS');
    expect(categoryOption().textContent).not.toContain('ID:');
    categoryOption().click();
    await nextTick();
  });

  it('edits titles, categories and tags inline and applies them through mocks', async () => {
    await boot();
    await setValue('Добавить тег', 'Rust');
    queryField('Добавить тег')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await nextTick();
    expect(buttons(/^Удалить тег[: ]/)).toHaveLength(2);
    await click(/^Удалить тег[: ]/, 1);
    expect(buttons(/^Удалить тег[: ]/)).toHaveLength(1);
    await setValue('Название', 'Новое Twitch название');
    vi.useFakeTimers();
    await setValue('Категория', 'PUBG');
    await vi.advanceTimersByTimeAsync(250);
    expect(options()[0] ?? null).not.toBeNull();
    categoryOption().click();
    await nextTick();
    expect(options()[0] ?? null).toBeNull();
    vi.useRealTimers();
    await click('Применить изменения');
    await flush();
    const twitch = mockStreamerbot.actionCalls.find((call) => call.args.command === 'updateTwitch');
    expect(JSON.parse(textValue(twitch?.args.payloadJson))).toMatchObject({
      title: '🔴 Новое Twitch название| !tg',
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('saves the combined form through mock Action replies and leaves no real side effects', async () => {
    await boot();
    await setValue('Название', 'Рейтинг');
    await click('Применить изменения');
    await flush();
    await flush();
    expect(commands()).toContain('saveTemplates');
    expect(commands()).toContain('updateTwitch');
  });

  it('closes notices and verifies import-screen copy/toggle/check actions', async () => {
    mockStreamerbot.actions = [];
    await boot();
    await click('Показать строку');
    expect(queryField('Import-строка Streamer.bot')).not.toBeNull();
    await click('Скопировать Import-строку');
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    await click('Проверить снова');
    await flush();
    expect(buttons('Проверить снова')[0] ?? null).not.toBeNull();

    mockStreamerbot.actions = [
      { id: 'api-action', name: 'STREAM INFO | API', group: 'STREAM INFO', enabled: true },
    ];
    await click('Проверить снова');
    await flush();
    await click('Настройки');
    await setValue('Шаблон Twitch', 'Тест %subtitle%');
    await click('Закрыть');
    vi.spyOn(required(mockStreamerbot.instances[0]), 'doAction').mockRejectedValueOnce(
      new Error('Fixture save failure'),
    );
    await click('Применить изменения');
    await flush();
    expect(document.querySelector('.notices > [role]')).not.toBeNull();
    await click('Закрыть уведомление');
    expect(document.querySelector('.notices > [role]')).toBeNull();
  });

  it('renders password reconnect', async () => {
    mockStreamerbot.failConnect = true;
    await boot();
    await setValue('Пароль', 'secret');
    await click('Подключиться');
    await flush();
    expect(mockStreamerbot.connectCalls).toBeGreaterThan(1);
  });

  it('offers re-import for the previous API before enabling editing', async () => {
    mockStreamerbot.state.apiVersion = 3;
    await boot();
    expect(buttons('Проверить снова')[0] ?? null).not.toBeNull();
    expect(document.querySelector('.inline-editor')).toBeNull();
    expect(commands()).toEqual(['getState']);
  });

  it('renders a single platform and sends only its metadata and template', async () => {
    await boot();
    expect(document.querySelectorAll('.platform-card')).toHaveLength(1);
    await setValue('Название', 'Twitch only');
    await setValue('Название', 'Updated');
    await click('Применить изменения');
    await flush();
    const calls = mockStreamerbot.actionCalls.filter((call) => call.args.command !== 'getState');
    expect(calls.map((call) => call.args.command)).toEqual(['saveTemplates', 'updateTwitch']);
    expect(Object.keys(parseRecord(textValue(calls[0]?.args.payloadJson))).sort()).toEqual([
      'subtitle',
      'twitchTemplate',
    ]);
    expect(Object.keys(parseRecord(textValue(calls[1]?.args.payloadJson)))).toEqual(['title']);
  });

  it('renders showcase data without opening a Streamer.bot connection in demo mode', async () => {
    window.history.replaceState({}, '', '/?demo=1');
    await boot();

    expect(mockStreamerbot.connectCalls).toBe(0);
    expect(document.querySelector('section[aria-label="Twitch"]')?.textContent).toContain(
      'Maseaaao',
    );
    expect(queryField('Название')).not.toBeNull();
  });

  it('shows the version opposite the last-updated time', async () => {
    await boot();

    const footer = required(document.querySelector<HTMLElement>('.dock-footer'));
    expect(footer.children).toHaveLength(2);
    expect(required(footer.children[0]).textContent).toContain(packageJson.version);
    expect(required(footer.children[1]).textContent).toContain('Обновлено:');
  });
  it('debounces category input for exactly 250ms and only searches the latest draft', async () => {
    await boot();
    vi.useFakeTimers();
    await setValue('Категория', 'Adv');
    await vi.advanceTimersByTimeAsync(249);
    expect(commands()).not.toContain('searchTwitchCategories');
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(249);
    expect(commands()).not.toContain('searchTwitchCategories');
    await vi.advanceTimersByTimeAsync(1);
    const calls = mockStreamerbot.actionCalls.filter(
      (call) => call.args.command === 'searchTwitchCategories',
    );
    expect(calls).toHaveLength(1);
    expect(parseRecord(textValue(required(calls[0]).args.payloadJson))).toEqual({
      query: 'Adventure',
    });
  });

  it('refreshes preset state after 700ms rather than immediately', async () => {
    await boot();
    vi.useFakeTimers();
    const before = commands().filter((command) => command === 'getState').length;
    await click('PUBG');
    await vi.advanceTimersByTimeAsync(0);
    expect(mockStreamerbot.actionCalls.some((call) => call.id === 'preset-pubg')).toBe(true);
    await vi.advanceTimersByTimeAsync(699);
    expect(commands().filter((command) => command === 'getState')).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(commands().filter((command) => command === 'getState')).toHaveLength(before + 1);
  });

  it('times out an unanswered category request after 15 seconds and allows retry', async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.deferSearch = true;
    await setValue('Категория', 'Adventure');
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(buttons('Повторить поиск')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('15 секунд');
    expect(button('Повторить поиск').disabled).toBe(false);
    required(mockStreamerbot.pendingSearches[0]).reply({
      data: { results: [{ id: 'late', name: 'Too late' }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(optionNamed('Too late')).toBeNull();
    await click('Повторить поиск');
    expect(mockStreamerbot.pendingSearches).toHaveLength(2);
    required(mockStreamerbot.pendingSearches[1]).reply({
      data: { results: [{ id: 'fresh', name: 'Adventure retry' }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(categoryOption().textContent?.trim()).toBe('Adventure retry');
  });

  it.each([true, false])(
    'restores a saved password only when rememberPassword is %s',
    async (rememberPassword) => {
      localStorage.setItem(
        'change-info-streamer-bot.settings.v1',
        JSON.stringify({
          host: 'localhost',
          port: 8123,
          endpoint: '/stream',
          password: 'saved-secret',
          rememberPassword,
        }),
      );
      await boot();
      expect(required(mockStreamerbot.instances[0]).options).toMatchObject({
        host: 'localhost',
        port: 8123,
        endpoint: '/stream',
        password: rememberPassword ? 'saved-secret' : undefined,
      });
      await click('Настройки');
      expect(field('Пароль').value).toBe(rememberPassword ? 'saved-secret' : '');
    },
  );

  it('keeps partial field failures dirty and retains the unsent tag draft', async () => {
    await boot();
    mockStreamerbot.actionReplies.updateTwitch = {
      ok: false,
      data: { fields: { title: true, category: false, tags: true } },
    };
    await setValue('Название', 'Partial title');
    await setValue('Добавить тег', 'Unsent');
    await click('Применить изменения');
    await flush();
    expect(commands()).toContain('saveTemplates');
    expect(commands()).toContain('updateTwitch');
    const notice = required(document.querySelector('[role="alert"]'));
    expect(notice.textContent).toContain('Не удалось изменить Twitch');
    expect(Array.from(notice.querySelectorAll('.notice-line'), (line) => line.textContent)).toEqual(
      ['Название: успешно', 'Категория: ошибка', 'Теги: успешно'],
    );
    expect(field('Добавить тег').value).toBe('Unsent');
    expect(
      document.querySelector('[aria-label="Изменить информацию"] [role="status"]')?.textContent,
    ).toBe('Есть несохранённые изменения');
    expect(button('Применить изменения').disabled).toBe(false);
  });

  it('unmounts timers and visibility listener and ignores retired replies after remount', async () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    await boot();
    const old = required(mockStreamerbot.instances[0]);
    const disconnect = vi.spyOn(old, 'disconnect');
    const listener = required(
      addListener.mock.calls.find(([event]) => event === 'visibilitychange'),
    )[1];
    expect(vi.getTimerCount()).toBe(1);
    mockStreamerbot.deferSearch = true;
    await setValue('Категория', 'Retired query');
    await vi.advanceTimersByTimeAsync(250);
    const stale = required(mockStreamerbot.pendingSearches[0]);
    required(dock).dispose();
    dock = undefined;
    await vi.advanceTimersByTimeAsync(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(
      removeListener.mock.calls.some(
        ([event, callback]) => event === 'visibilitychange' && callback === listener,
      ),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const before = mockStreamerbot.actionCalls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockStreamerbot.actionCalls).toHaveLength(before);

    await boot();
    expect(vi.getTimerCount()).toBe(1);
    await setValue('Категория', 'Current query');
    await vi.advanceTimersByTimeAsync(250);
    stale.reply({ data: { results: [{ id: 'stale', name: 'Retired result' }] } });
    old.options.onConnect?.();
    old.options.onError?.(new Error('retired password error'));
    old.options.onDisconnect?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(field('Категория').value).toBe('Current query');
    expect(optionNamed('Retired result')).toBeNull();
    expect(roleText('status', 'Streamer.bot подключён')).not.toBeNull();
    expect(document.querySelector('.auth-panel')).toBeNull();
    required(mockStreamerbot.pendingSearches[1]).reply({
      data: { results: [{ id: 'current', name: 'Current result' }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(categoryOption().textContent?.trim()).toBe('Current result');
  });

  it("does not expose a theme selector or apply another tab's old preference", async () => {
    await boot();
    expect(document.querySelector('.theme-control')).toBeNull();
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'stream-info.theme.v1', newValue: 'dark' }),
    );
    await nextTick();
    expect(document.documentElement.dataset.theme).not.toBe('dark');
  });

  it('keeps an explicitly mounted showcase offline even when saving connection settings', async () => {
    const { initDock } = await import('../src/render');
    dock = initDock(required(document.querySelector('#app')), { demo: true });
    await flush();
    await flush();
    expect(mockStreamerbot.connectCalls).toBe(0);
    expect(field('Название').value).toBe('Ranked with chat');
    await click('Настройки');
    await click('Сохранить подключение');
    await flush();
    expect(mockStreamerbot.connectCalls).toBe(0);
    expect(mockStreamerbot.actionCalls).toHaveLength(0);
  });
});
