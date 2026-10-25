import { type StreamerbotAction, StreamerbotClient } from '@streamerbot/client';
import packageJson from '../package.json';
import { rankCategories } from './category-search';
import { t } from './messages';
import { reactive } from './reactive';
import { DEFAULT_TWITCH_TEMPLATE, isTemplateValid, titleFromTemplate } from './templates';
import type {
  ActionResponse,
  ActionSummary,
  AllForm,
  ConnectionSettings,
  Platform,
  StreamState,
  TemplateState,
  TwitchCategory,
  TwitchState,
} from './types';

const API_VERSION = 4;
const APP_VERSION = packageJson.version;
const ACTION_GROUP = 'STREAM INFO';
const ACTION_NAME = 'STREAM INFO | API';
const PRESET_PREFIX = 'PRESET |';
const CODE_EVENT = 'stream_info_api_response';
const STORAGE_KEY = 'change-info-streamer-bot.settings.v1';
const TEMPLATE_DRAFT_KEY = 'change-info-streamer-bot.template-draft.v1';
const REQUEST_TIMEOUT = 15_000;
const AUTH_HINT = /auth|password|credential/i;
/** Любой пробельный символ внутри тега недопустим по правилам Twitch. */
const SPACED_TAG = /\s/;

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type ActionStatus = 'unknown' | 'ready' | 'missing' | 'disabled' | 'outdated';
type Modal = 'settings' | null;
type CardEffect = 'success' | 'flash-error' | null;

type NoticeKind = 'info' | 'warning' | 'error' | 'success';

export interface Notice {
  id: string;
  kind: NoticeKind;
  lines: string[];
  title: string;
}

export interface PresetAction extends ActionSummary {
  label: string;
}

interface TemplateDraft {
  subtitle: string;
  twitchTemplate: string;
}

interface TwitchUpdatePayload extends Record<string, unknown> {
  categoryId?: string;
  tags?: string[];
  title?: string;
}

interface CommandPayloads {
  getState: Record<string, never>;
  saveTemplates: { twitchTemplate: string; subtitle: string };
  searchTwitchCategories: { query: string; cursor?: string };
  updateTwitch: TwitchUpdatePayload;
}

interface AppState {
  action: ActionSummary | null;
  actionStatus: ActionStatus;
  allDirty: boolean;
  allForm: AllForm | null;
  allSaveResult: 'saved' | 'partial' | null;
  allSaving: boolean;
  authNeeded: boolean;
  cardEffects: Record<Platform, CardEffect>;
  cardErrors: Record<Platform, boolean>;
  connection: ConnectionStatus;
  connectionError: string | null;
  importCopied: boolean;
  lastUpdated: Date | null;
  loadingTwitch: boolean;
  modal: Modal;
  notices: Notice[];
  presetActions: PresetAction[];
  runningPresetId: string | null;
  settingsDraft: ConnectionSettings;
  showImport: boolean;
  stream: StreamState | null;
  subtitleDirty: boolean;
  templateDraft: TemplateDraft;
  templatesDirty: boolean;
  twitchResults: TwitchCategory[];
  twitchSearchFor: string;
}

const defaults: ConnectionSettings = {
  endpoint: '/',
  host: '127.0.0.1',
  lastSubtitle: '',
  password: '',
  port: 8080,
  rememberPassword: false,
  twitchEnabled: true,
  twitchTemplate: DEFAULT_TWITCH_TEMPLATE,
};

interface SearchStatus {
  searchCursor: string | null;
  searchError: string | null;
  searchHasMore: boolean;
  searchPartial: boolean;
  searchWarnings: string[];
  twitchSearching: boolean;
  visibleCategories: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function uuid(): string {
  return crypto.randomUUID();
}

function loadSettings(): ConnectionSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!isRecord(saved)) {
      return { ...defaults };
    }
    return {
      endpoint: typeof saved.endpoint === 'string' ? saved.endpoint : defaults.endpoint,
      host: typeof saved.host === 'string' ? saved.host : defaults.host,
      lastSubtitle: typeof saved.lastSubtitle === 'string' ? saved.lastSubtitle : '',
      password:
        saved.rememberPassword === true && typeof saved.password === 'string' ? saved.password : '',
      port:
        typeof saved.port === 'number' && Number.isFinite(saved.port) ? saved.port : defaults.port,
      rememberPassword: saved.rememberPassword === true,
      twitchEnabled: true,
      twitchTemplate:
        typeof saved.twitchTemplate === 'string' ? saved.twitchTemplate : defaults.twitchTemplate,
    };
  } catch {
    return { ...defaults };
  }
}
function restoreTemplateDraft(): Pick<TemplateDraft, 'twitchTemplate'> | null {
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(TEMPLATE_DRAFT_KEY) ?? 'null');
    if (typeof draft !== 'object' || draft === null || !('twitchTemplate' in draft)) {
      return null;
    }
    if (typeof draft.twitchTemplate !== 'string') {
      return null;
    }
    return { twitchTemplate: draft.twitchTemplate };
  } catch {
    return null;
  }
}

function parseResponse(value: unknown): ActionResponse | null {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    typeof value.apiVersion !== 'number' ||
    typeof value.command !== 'string' ||
    typeof value.ok !== 'boolean'
  ) {
    return null;
  }
  if (value.data !== null && !isRecord(value.data)) {
    return null;
  }
  if (value.error !== null && (!isRecord(value.error) || typeof value.error.message !== 'string')) {
    return null;
  }
  return {
    apiVersion: value.apiVersion,
    command: value.command,
    data: value.data,
    error:
      isRecord(value.error) && typeof value.error.message === 'string'
        ? { message: value.error.message }
        : null,
    ok: value.ok,
    requestId: value.requestId,
  };
}

export function createStreamInfo(options: { demo?: boolean } = {}): StreamInfo {
  const demoMode = options.demo ?? new URLSearchParams(window.location.search).has('demo');
  const settings = reactive(loadSettings());
  const recoveredDraft = restoreTemplateDraft();
  const state = reactive<AppState>({
    action: null,
    actionStatus: 'unknown',
    allDirty: false,
    allForm: null,
    allSaveResult: null,
    allSaving: false,
    authNeeded: false,
    cardEffects: { twitch: null },
    cardErrors: { twitch: false },
    connection: 'connecting',
    connectionError: null,
    importCopied: false,
    lastUpdated: null,
    loadingTwitch: false,
    modal: null,
    notices: [],
    presetActions: [],
    runningPresetId: null,
    settingsDraft: { ...settings },
    showImport: false,
    stream: null,
    subtitleDirty: false,
    templateDraft: {
      subtitle: settings.lastSubtitle,
      twitchTemplate: recoveredDraft?.twitchTemplate ?? settings.twitchTemplate,
    },
    templatesDirty:
      recoveredDraft !== null && recoveredDraft.twitchTemplate !== settings.twitchTemplate,
    twitchResults: [],
    twitchSearchFor: '',
  });

  function saveSettings(): void {
    const persisted: ConnectionSettings = {
      ...settings,
      password: settings.rememberPassword ? settings.password : '',
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      /* Embedded storage can be disabled. */
    }
  }

  function notify(title: string, lines: string[], kind: NoticeKind = 'error'): void {
    state.notices.unshift({ id: uuid(), kind, lines, title });
  }

  /** Показывает сбой с сообщением самой ошибки, когда она известна. */
  function notifyError(titleKey: Parameters<typeof t>[0], error: unknown): void {
    notify(t(titleKey), [error instanceof Error ? error.message : t('unknownError')]);
  }

  function closeNotice(id: string): void {
    state.notices = state.notices.filter((notice) => notice.id !== id);
  }

  function enableDemoMode(): void {
    const stream: StreamState = {
      apiVersion: API_VERSION,
      templates: {
        configured: true,
        subtitle: 'Ranked with chat',
        twitchTemplate: '🔴 %subtitle% | !tg !yt !tw !donate',
      },
      twitch: {
        accountName: 'Maseaaao',
        categoryId: '493057',
        categoryImageUrl: '',
        categoryName: 'PUBG: BATTLEGROUNDS',
        connected: true,
        live: true,
        login: 'maseaaao',
        tags: ['PUBG', 'Ranked', 'RU'],
        title: 'Ranked grind — road to Diamond',
      },
    };
    state.connection = 'connected';
    state.actionStatus = 'ready';
    state.action = { enabled: true, group: ACTION_GROUP, id: 'demo-action', name: ACTION_NAME };
    state.stream = stream;
    state.templateDraft = {
      subtitle: stream.templates.subtitle,
      twitchTemplate: stream.templates.twitchTemplate,
    };
    state.presetActions = [
      { enabled: true, group: ACTION_GROUP, id: 'demo-pubg', label: 'PUBG', name: 'PRESET | PUBG' },
      {
        enabled: true,
        group: ACTION_GROUP,
        id: 'demo-just-chatting',
        label: 'Just Chatting',
        name: 'PRESET | Just Chatting',
      },
    ];
    state.lastUpdated = new Date();
  }

  let client: StreamerbotClient | null = null;
  let connectionGeneration = 0;
  let operationGeneration = 0;
  let stateRevision = 0;
  const requestResolvers = new Map<
    string,
    {
      generation: number;
      command: keyof CommandPayloads;
      resolve: (response: ActionResponse) => void;
      reject: (reason: Error) => void;
      timer: number;
    }
  >();
  let pollingId: number | null = null;
  let searchTimer: number | null = null;
  let searchGeneration = 0;
  let failedSearch: SearchJob | null = null;
  interface SearchJob {
    cursor?: string;
    generation: number;
    query: string;
  }
  interface SearchPage {
    cursor: string | null;
    hasMore: boolean;
    partial: boolean;
    results: TwitchCategory[];
    warnings: string[];
  }
  let searchFlight: SearchJob | null = null;
  let queuedSearch: SearchJob | null = null;

  const search = reactive<SearchStatus>({
    searchCursor: null,
    searchError: null,
    searchHasMore: false,
    searchPartial: false,
    searchWarnings: [],
    twitchSearching: false,
    visibleCategories: 20,
  });

  function resetCategorySearch(): void {
    searchGeneration += 1;
    if (searchTimer !== null) {
      cancelTimer(searchTimer);
    }
    searchTimer = null;
    queuedSearch = null;
    search.twitchSearching = false;
    search.searchError = null;
    search.searchCursor = null;
    search.searchHasMore = false;
    search.searchWarnings = [];
    search.searchPartial = false;
    search.visibleCategories = 20;
    failedSearch = null;
    state.twitchResults = [];
    state.twitchSearchFor = '';
  }

  function rejectPendingRequests(): void {
    for (const pending of requestResolvers.values()) {
      cancelTimer(pending.timer);
      pending.reject(new Error(t('connectionChanged')));
    }
    requestResolvers.clear();
  }
  let actionCheckRunning = false;

  function connectionText(): string {
    if (state.connection === 'connected') {
      return t('connectionConnected');
    }
    if (state.connection === 'connecting') {
      return t('connectionConnecting');
    }
    return t('connectionDisconnected');
  }

  function cardStatus(platform: Platform): 'live' | 'offline' | 'disconnected' {
    const value = state.stream?.[platform];
    if (!value?.connected) {
      return 'disconnected';
    }
    return value.live ? 'live' : 'offline';
  }

  function platformEnabled(_platform: Platform): boolean {
    return settings.twitchEnabled;
  }

  function platformAvailable(platform: Platform): boolean {
    const { stream } = state;
    return platformEnabled(platform) && Boolean(stream?.twitch.connected);
  }

  function platformLoading(platform: Platform): boolean {
    return platform === 'twitch' && state.loadingTwitch;
  }

  function busy(): boolean {
    return state.allSaving || platformLoading('twitch');
  }

  function inlineTitle(_platform: Platform, form: AllForm): string {
    const mode = form.twitchTitleMode;
    const title = form.twitchTitle;
    const template = state.templateDraft.twitchTemplate;
    return mode === 'subtitle' ? titleFromTemplate(template, form.subtitle) : title.trim();
  }

  function textValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    return '';
  }

  function normalizeStream(data: Record<string, unknown>): StreamState {
    const twitchRaw = isRecord(data.twitch) ? data.twitch : {};
    const templates = normalizeTemplates(data.templates);
    const twitch: TwitchState = {
      accountName: textValue(twitchRaw.accountName),
      broadcasterId: textValue(twitchRaw.broadcasterId),
      categoryId: textValue(twitchRaw.categoryId),
      categoryImageUrl: textValue(twitchRaw.categoryImageUrl),
      categoryName: textValue(twitchRaw.categoryName),
      connected: twitchRaw.connected === true,
      live: twitchRaw.live === true,
      login: textValue(twitchRaw.login),
      tags: asStringArray(twitchRaw.tags),
      title: textValue(twitchRaw.title),
    };
    return { apiVersion: Number(data.apiVersion ?? API_VERSION), templates, twitch };
  }

  function normalizeTemplates(value: unknown): TemplateState {
    const raw = isRecord(value) ? value : {};
    return {
      configured: raw.configured === true,
      subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : '',
      twitchTemplate:
        typeof raw.twitchTemplate === 'string' && raw.twitchTemplate
          ? raw.twitchTemplate
          : DEFAULT_TWITCH_TEMPLATE,
    };
  }

  function updateTemplatesDirty(): void {
    state.templatesDirty = state.templateDraft.twitchTemplate !== settings.twitchTemplate;
    try {
      if (state.templatesDirty) {
        sessionStorage.setItem(
          TEMPLATE_DRAFT_KEY,
          JSON.stringify({
            twitchTemplate: state.templateDraft.twitchTemplate,
          }),
        );
      } else {
        sessionStorage.removeItem(TEMPLATE_DRAFT_KEY);
      }
    } catch {
      // Storage may be disabled in an embedded browser; keep the in-memory draft.
    }
  }

  function syncTemplates(templates: TemplateState, preserveDraft = false): void {
    const hasLocalCustomTemplate =
      settings.twitchTemplate !== DEFAULT_TWITCH_TEMPLATE || Boolean(settings.lastSubtitle);
    if (!templates.configured && hasLocalCustomTemplate) {
      return;
    }
    Object.assign(settings, {
      lastSubtitle: templates.subtitle,
      twitchTemplate: templates.twitchTemplate,
    });
    saveSettings();
    if (!(preserveDraft || state.templatesDirty || state.subtitleDirty)) {
      state.templateDraft = {
        subtitle: templates.subtitle,
        twitchTemplate: templates.twitchTemplate,
      };
    }
    updateTemplatesDirty();
  }

  function handleCodeEvent(payload: unknown): void {
    const root = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    if (!root || root.eventName !== CODE_EVENT || !isRecord(root.args)) {
      return;
    }
    if (typeof root.args.requestId !== 'string') {
      return;
    }
    const pending = requestResolvers.get(root.args.requestId);
    if (!pending || pending.generation !== connectionGeneration) {
      return;
    }
    const response = parseResponse(root.args);
    if (response && response.command === pending.command) {
      pending.resolve(response);
    } else {
      pending.reject(new Error(t('actionStateFailed')));
    }
  }

  /** Собирает клиент Streamer.bot с реакциями на смену состояния соединения. */
  function createStreamClient(generation: number, isCurrent: () => boolean): StreamerbotClient {
    return new StreamerbotClient({
      autoReconnect: true,
      endpoint: settings.endpoint || '/',
      host: settings.host,
      immediate: false,
      logLevel: 'none',
      onConnect: () => {
        if (isCurrent()) {
          fireAndForget(onConnected(generation));
        }
      },
      onDisconnect: () => {
        if (!isCurrent()) {
          return;
        }
        operationGeneration += 1;
        resetBusy();
        stateRevision += 1;
        actionCheckRunning = false;
        resetCategorySearch();
        rejectPendingRequests();
        state.connection = 'disconnected';
        state.actionStatus = 'unknown';
        state.stream = null;
      },
      onError: (error: unknown) => {
        if (!isCurrent()) {
          return;
        }
        markConnectionFailed(error instanceof Error ? error.message : t('connectFailed'));
      },
      password: settings.password || undefined,
      port: settings.port,
      retries: -1,
    });
  }

  /** Освобождает отработанный клиент; старый сокет мог уже закрыться — сбой не важен. */
  async function closePreviousClient(previous: StreamerbotClient | null): Promise<void> {
    if (!previous) {
      return;
    }
    try {
      await previous.disconnect();
    } catch {
      /* the old socket may already be closed */
    }
  }

  /** Фиксирует разрыв соединения и признак необходимости повторной авторизации. */
  function markConnectionFailed(message: string): void {
    state.connection = 'disconnected';
    state.connectionError = message;
    state.authNeeded = AUTH_HINT.test(message);
  }

  async function connect(): Promise<void> {
    if (disposed || demoMode) {
      return;
    }
    operationGeneration += 1;
    resetBusy();
    connectionGeneration += 1;
    const generation = connectionGeneration;
    const previous = client;
    client = null;
    actionCheckRunning = false;
    resetCategorySearch();
    state.connection = 'connecting';
    state.connectionError = null;
    rejectPendingRequests();
    await closePreviousClient(previous);
    if (disposed || generation !== connectionGeneration) {
      return;
    }
    const isCurrent = () => !disposed && generation === connectionGeneration && client === next;
    const next = createStreamClient(generation, isCurrent);
    client = next;
    try {
      await next.on('Custom.CodeEvent', (payload) => {
        if (isCurrent()) {
          handleCodeEvent(payload);
        }
      });
      if (!isCurrent()) {
        return;
      }
      await next.connect();
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      markConnectionFailed(error instanceof Error ? error.message : t('connectFailed'));
    }
  }

  async function onConnected(generation = connectionGeneration): Promise<void> {
    if (disposed || generation !== connectionGeneration) {
      return;
    }
    state.connection = 'connected';
    state.connectionError = null;
    state.authNeeded = false;
    await verifyAction();
    if (generation !== connectionGeneration || state.connection !== 'connected') {
      return;
    }
    if (state.allForm?.twitchCategoryQuery.trim()) {
      scheduleTwitchSearch(state.allForm.twitchCategoryQuery);
    }
  }

  /** Сопоставляет ответ Streamer.bot с состоянием приложения. */
  function applyActions(actions: StreamerbotAction[]): ActionStatus {
    const action =
      actions.find(
        (candidate) => candidate.group === ACTION_GROUP && candidate.name === ACTION_NAME,
      ) ?? null;
    state.action = action
      ? { enabled: action.enabled, group: action.group, id: action.id, name: action.name }
      : null;
    state.presetActions = actions
      .filter(
        (candidate) =>
          candidate.enabled &&
          candidate.group === ACTION_GROUP &&
          candidate.name.startsWith(PRESET_PREFIX),
      )
      .map((candidate) => ({
        enabled: candidate.enabled,
        group: candidate.group,
        id: candidate.id,
        label: candidate.name.slice(PRESET_PREFIX.length).trim() || candidate.name,
        name: candidate.name,
      }));
    let status: ActionStatus;
    if (action) {
      status = action.enabled ? 'ready' : 'disabled';
    } else {
      status = 'missing';
    }
    state.actionStatus = status;
    return status;
  }

  async function verifyAction(): Promise<void> {
    if (disposed || !client?.ready || actionCheckRunning) {
      return;
    }
    const owner = client;
    const generation = connectionGeneration;
    const revision = stateRevision;
    const isCurrent = () =>
      generation === connectionGeneration && owner === client && revision === stateRevision;
    actionCheckRunning = true;
    state.actionStatus = 'unknown';
    try {
      const response = await owner.getActions();
      if (!isCurrent()) {
        return;
      }
      const status = applyActions(response.actions);
      if (status === 'ready') {
        await refreshState();
      }
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      state.connection = 'disconnected';
      state.connectionError = error instanceof Error ? error.message : t('actionsFailed');
      state.authNeeded = AUTH_HINT.test(state.connectionError);
    } finally {
      if (generation === connectionGeneration && owner === client) {
        actionCheckRunning = false;
      }
    }
  }

  function callAction(command: 'getState'): Promise<ActionResponse>;
  function callAction<Command extends keyof CommandPayloads>(
    command: Command,
    payload: CommandPayloads[Command],
  ): Promise<ActionResponse>;
  async function callAction(
    command: keyof CommandPayloads,
    payload: Record<string, unknown> = {},
  ): Promise<ActionResponse> {
    if (disposed || !client?.ready || !state.action) {
      throw new Error(t('actionUnavailable'));
    }
    const owner = client;
    const generation = connectionGeneration;
    const requestId = uuid();
    const actionId = state.action.id;
    try {
      return await new Promise<ActionResponse>((resolve, reject) => {
        let acknowledged = false;
        let response: ActionResponse | null = null;
        const finish = () => {
          if (acknowledged && response) {
            resolve(response);
          }
        };
        // The deadline covers both independent completions, including event-first.
        const timer = later(() => reject(new Error(t('actionTimeout'))), REQUEST_TIMEOUT);
        requestResolvers.set(requestId, {
          command,
          generation,
          reject,
          resolve: (value) => {
            response ??= value;
            finish();
          },
          timer,
        });
        owner
          .doAction({ id: actionId }, { command, payloadJson: JSON.stringify(payload), requestId })
          .then(() => {
            acknowledged = true;
            finish();
          }, reject);
      });
    } finally {
      const pending = requestResolvers.get(requestId);
      if (pending) {
        cancelTimer(pending.timer);
        requestResolvers.delete(requestId);
      }
    }
  }

  async function persistSubtitle(subtitle: string): Promise<boolean> {
    const current = taskGuard();
    const value = subtitle.trim();
    const template = state.templateDraft.twitchTemplate;
    if (value === settings.lastSubtitle && template === settings.twitchTemplate) {
      state.subtitleDirty = false;
      return true;
    }
    if (disposed || !client?.ready || !state.action) {
      return false;
    }
    try {
      const response = await callAction('saveTemplates', {
        subtitle: value,
        twitchTemplate: template,
      });
      if (!current()) {
        return false;
      }
      if (!response.ok) {
        throw new Error(response.error?.message ?? t('subtitleStateSaveFailed'));
      }
      settings.lastSubtitle = value;
      settings.twitchTemplate = template;
      updateTemplatesDirty();
      saveSettings();
      // Do not overwrite newer editor input after a slow acknowledgement.
      if (state.templateDraft.subtitle.trim() === value) {
        state.subtitleDirty = false;
      }
      return true;
    } catch (error) {
      if (!current()) {
        return false;
      }
      notifyError('subtitleSaveFailed', error);
      return false;
    }
  }

  async function runPreset(id: string, name: string): Promise<void> {
    const current = taskGuard();
    if (!client?.ready) {
      return;
    }
    state.runningPresetId = id;
    try {
      await client.doAction({ id }, {});
      if (!current()) {
        return;
      }
      later(() => {
        if (current()) {
          fireAndForget(refreshState(false));
        }
      }, 700);
      notify(t('presetStarted'), [name], 'info');
    } catch (error) {
      if (!current()) {
        return;
      }
      notify(t('presetStartFailed'), [error instanceof Error ? error.message : t('unknownError')]);
    } finally {
      if (current()) {
        state.runningPresetId = null;
      }
    }
  }

  /** Применяет ответ getState; возвращает false, если экстракт состояния непригоден. */
  function applyStateResponse(response: ActionResponse): boolean {
    if (!(response.ok && response.data)) {
      throw new Error(response.error?.message ?? t('actionStateFailed'));
    }
    const stream = normalizeStream(response.data);
    if (stream.apiVersion !== API_VERSION || response.apiVersion !== API_VERSION) {
      state.actionStatus = 'outdated';
      state.stream = null;
      return false;
    }
    syncTemplates(stream.templates);
    state.stream = stream;
    if (!(state.allDirty || state.allSaving)) {
      initializeEditor();
    }
    state.lastUpdated = new Date();
    return true;
  }

  async function refreshState(showError = true): Promise<void> {
    if (disposed || state.actionStatus !== 'ready') {
      return;
    }
    const generation = connectionGeneration;
    stateRevision += 1;
    const revision = stateRevision;
    const isCurrent = () => generation === connectionGeneration && revision === stateRevision;
    try {
      const response = await callAction('getState');
      if (!isCurrent()) {
        return;
      }
      applyStateResponse(response);
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      if (showError) {
        notifyError('refreshFailed', error);
      }
    }
  }

  function categoryFromState(_platform: Platform): TwitchCategory | null {
    const item = state.stream?.twitch;
    if (!(item?.categoryId || item?.categoryName)) {
      return null;
    }
    return {
      id: item.categoryId ?? '',
      imageUrl: item.categoryImageUrl ?? '',
      name: item.categoryName ?? '',
    };
  }

  function initializeEditor(preservePlatforms: Platform[] = []): void {
    if (!state.stream) {
      return;
    }
    const previous = state.allForm;
    resetCategorySearch();
    state.allForm = {
      subtitle: state.templateDraft.subtitle,
      twitchCategory: categoryFromState('twitch'),
      twitchCategoryQuery: '',
      twitchTagDraft: previous?.twitchTagDraft ?? '',
      twitchTags: [...asStringArray(state.stream.twitch.tags)],
      twitchTitle: state.stream.twitch.title ?? '',
      twitchTitleMode: previous?.twitchTitleMode ?? 'subtitle',
    };
    if (previous && (!settings.twitchEnabled || preservePlatforms.includes('twitch'))) {
      state.allForm.twitchTitle = previous.twitchTitle;
      state.allForm.twitchCategory = previous.twitchCategory;
      state.allForm.twitchTags = previous.twitchTags;
      state.allForm.twitchTagDraft = previous.twitchTagDraft;
      state.allForm.twitchCategoryQuery = previous.twitchCategoryQuery;
    }
  }

  function tagsEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }

  function validateTwitch(title: string, tags: string[]): string[] {
    const errors: string[] = [];
    if (!title.trim()) {
      errors.push(t('twitchTitleRequired'));
    }
    if (title.length > 140) {
      errors.push(t('twitchTitleTooLong'));
    }
    if (tags.length > 10) {
      errors.push(t('twitchTagsTooMany'));
    }
    if (tags.some((tag) => !tag.trim() || tag.length > 25 || SPACED_TAG.test(tag))) {
      errors.push(t('twitchTagsInvalid'));
    }
    if (new Set(tags.map((tag) => tag.toLocaleLowerCase('ru-RU'))).size !== tags.length) {
      errors.push(t('twitchTagsDuplicate'));
    }
    return errors;
  }

  function validateAll(form: AllForm): string[] {
    const messages: string[] = [];
    if (platformAvailable('twitch') && form.twitchCategoryQuery.trim()) {
      messages.push(t('categorySelectionRequired', { platform: 'Twitch' }));
    }
    if (!isTemplateValid(state.templateDraft.twitchTemplate)) {
      messages.push(t('templateValidation'));
    }
    if (platformAvailable('twitch')) {
      messages.push(...validateTwitch(inlineTitle('twitch', form), form.twitchTags));
    }
    return messages;
  }

  function flashCard(platform: Platform, ok: boolean): void {
    const current = taskGuard();
    if (ok) {
      state.cardErrors[platform] = false;
      state.cardEffects[platform] = 'success';
      later(() => {
        if (current()) {
          state.cardEffects[platform] = null;
        }
      }, 3000);
    } else {
      state.cardErrors[platform] = true;
      state.cardEffects[platform] = 'flash-error';
      later(() => {
        if (current()) {
          state.cardEffects[platform] = null;
        }
      }, 5000);
    }
  }

  function fieldsToLines(fields: unknown, _platform: Platform): string[] {
    const source = isRecord(fields) ? fields : {};
    const labels: Record<string, string> = {
      category: t('category'),
      tags: t('tags'),
      title: t('title'),
    };
    const lines = Object.entries(source).map(
      ([key, value]) =>
        `${labels[key] ?? key}: ${value === true ? t('fieldSuccess') : t('fieldError')}`,
    );
    return lines.length ? lines : [t('twitchChangesFailed')];
  }

  async function updatePlatform(
    platform: Platform,
    payload: TwitchUpdatePayload,
  ): Promise<boolean> {
    const current = taskGuard();
    if (!Object.keys(payload).length) {
      return true;
    }
    state.loadingTwitch = true;
    try {
      const response = await callAction('updateTwitch', payload);
      if (!current()) {
        return false;
      }
      const { ok } = response;
      flashCard(platform, ok);
      if (!ok) {
        notify(
          t('updateFailed', { platform: 'Twitch' }),
          fieldsToLines(response.data?.fields, platform),
        );
      }
      await refreshState(false);
      return ok;
    } catch (error) {
      if (!current()) {
        return false;
      }
      flashCard(platform, false);
      notify(t('updateFailed', { platform: 'Twitch' }), [
        error instanceof Error ? error.message : t('unknownError'),
      ]);
      await refreshState(false);
      return false;
    } finally {
      if (current()) {
        state.loadingTwitch = false;
      }
    }
  }

  /** Собирает отличия формы Twitch от опубликованного состояния. */
  function buildTwitchPayload(form: AllForm, stream: StreamState): TwitchUpdatePayload {
    const payload: TwitchUpdatePayload = {};
    if (!platformAvailable('twitch')) {
      return payload;
    }
    const twitchTitle = inlineTitle('twitch', form);
    if (twitchTitle !== stream.twitch.title) {
      payload.title = twitchTitle;
    }
    if (form.twitchCategory && form.twitchCategory.id !== stream.twitch.categoryId) {
      payload.categoryId = form.twitchCategory.id;
    }
    if (!tagsEqual(form.twitchTags, asStringArray(stream.twitch.tags))) {
      payload.tags = form.twitchTags;
    }
    return payload;
  }

  /** Отличает неотправленные правки платформы после успешного сохранения. */
  function hasPendingEdits(platform: Platform, form: AllForm, stream: StreamState): boolean {
    const published = stream[platform];
    const category = form.twitchCategory;
    return (
      inlineTitle(platform, form) !== published.title ||
      (category !== null && category.id !== published.categoryId) ||
      !tagsEqual(form.twitchTags, asStringArray(published.tags)) ||
      form.twitchCategoryQuery.trim().length > 0
    );
  }

  /** По успешным сохранениям восстанавливает редактор и помечает остаточные правки. */
  function applySaveResults(form: AllForm, stream: StreamState, results: boolean[]): void {
    if (!results.every(Boolean)) {
      return;
    }
    const platforms: Platform[] = ['twitch'];
    const preserved = platforms.filter((platform) => !platformAvailable(platform));
    const pending =
      preserved.some((platform) => hasPendingEdits(platform, form, stream)) ||
      Boolean(form.twitchTagDraft.trim());
    initializeEditor(preserved);
    state.allDirty = pending;
    state.allSaveResult = pending ? 'partial' : 'saved';
  }

  /** Сохраняет подпись и шаблон, когда они изменились; true также при совпадении без правок. */
  async function persistSubtitleIfChanged(form: AllForm): Promise<boolean> {
    if (form.subtitle.trim() === settings.lastSubtitle && !state.templatesDirty) {
      state.subtitleDirty = false;
      return true;
    }
    const saved = await persistSubtitle(form.subtitle);
    return saved;
  }

  async function saveAll(): Promise<void> {
    const current = taskGuard();
    const { allForm: form, stream } = state;
    if (!(form && stream) || busy() || !platformAvailable('twitch')) {
      return;
    }
    const errors = validateAll(form);
    if (errors.length) {
      return;
    }
    state.allSaving = true;
    try {
      if (!(await persistSubtitleIfChanged(form))) {
        return;
      }
      if (!current()) {
        return;
      }
      const twitchPayload = buildTwitchPayload(form, stream);
      const jobs: Promise<boolean>[] = [];
      if (Object.keys(twitchPayload).length) {
        jobs.push(updatePlatform('twitch', twitchPayload));
      }
      if (!jobs.length) {
        notify(t('unchanged'), [t('unchangedDescription')], 'info');
      }
      const results = await Promise.all(jobs);
      if (!current()) {
        return;
      }
      applySaveResults(form, stream, results);
    } finally {
      if (current()) {
        state.allSaving = false;
      }
    }
  }

  function addTag(scope: string): void {
    const holder = getTagHolder(scope);
    if (!holder) {
      return;
    }
    markDirty();
    const value = holder.draft.trim();
    if (!value) {
      return;
    }
    if (
      !holder.tags.some((tag) => tag.localeCompare(value, 'ru', { sensitivity: 'accent' }) === 0)
    ) {
      holder.tags.push(value);
    }
    holder.setDraft('');
  }

  function getTagHolder(
    scope: string,
  ): { tags: string[]; draft: string; setDraft: (value: string) => void } | null {
    if (scope === 'all-twitch' && state.allForm) {
      return {
        draft: state.allForm.twitchTagDraft,
        setDraft: (value) => {
          if (state.allForm) {
            state.allForm.twitchTagDraft = value;
          }
        },
        tags: state.allForm.twitchTags,
      };
    }
    return null;
  }

  function chooseCategory(kind: Platform, scope: string, id: string): void {
    const category = state.twitchResults.find((item) => item.id === id);
    if (!category) {
      return;
    }
    if (scope === 'all-twitch' && state.allForm && kind === 'twitch') {
      state.allForm.twitchCategory = category;
      state.allForm.twitchCategoryQuery = '';
    }
    markDirty();
    if (kind === 'twitch') {
      resetCategorySearch();
    }
  }

  /** Проверяет и разбирает одну страницу ответа поиска категорий. */
  function parseSearchResponse(response: ActionResponse): SearchPage {
    if (!(response.ok && isRecord(response.data) && Array.isArray(response.data.results))) {
      throw new Error(response.error?.message ?? t('categorySearchFailed'));
    }
    const { data } = response;
    const cursor = typeof data.cursor === 'string' && data.cursor ? data.cursor : null;
    const rows = Array.isArray(data.results) ? data.results : [];
    return {
      cursor,
      hasMore: data.hasMore === true && cursor !== null,
      partial: data.partial === true,
      results: rows
        .filter(isRecord)
        .map((item) => ({
          id: textValue(item.id),
          imageUrl: textValue(item.imageUrl),
          name: textValue(item.name),
        }))
        .filter((item) => item.id && item.name),
      warnings: asStringArray(data.warnings),
    };
  }

  /** Применяет страницу результатов поиска, объединяя её с накопленным выводом. */
  function applySearchResults(job: SearchJob, page: SearchPage): void {
    state.twitchResults = rankCategories(
      job.cursor ? [...state.twitchResults, ...page.results] : page.results,
      job.query,
    );
    search.searchCursor = page.cursor;
    search.searchHasMore = page.hasMore;
    search.searchPartial = (Boolean(job.cursor) && search.searchPartial) || page.partial;
    search.searchWarnings = Array.from(
      new Set([...(job.cursor ? search.searchWarnings : []), ...page.warnings]),
    );
    search.searchError = null;
    failedSearch = null;
    if (job.cursor) {
      search.visibleCategories += 20;
    }
  }

  /** Снимает блокировку поиска и запускает отложенный запрос, когда тот актуален. */
  function releaseSearchFlight(job: SearchJob): void {
    searchFlight = null;
    if (job.generation === searchGeneration) {
      search.twitchSearching = false;
    }
    const next = queuedSearch;
    queuedSearch = null;
    if (!disposed && next && next.generation === searchGeneration) {
      fireAndForget(runSearch(next));
    }
  }

  async function runSearch(job: SearchJob): Promise<void> {
    if (searchFlight) {
      queuedSearch = job;
      return;
    }
    searchFlight = job;
    try {
      const response = await callAction('searchTwitchCategories', {
        query: job.query,
        ...(job.cursor ? { cursor: job.cursor } : {}),
      });
      if (job.generation !== searchGeneration) {
        return;
      }
      applySearchResults(job, parseSearchResponse(response));
    } catch (error) {
      if (job.generation === searchGeneration) {
        search.searchError = error instanceof Error ? error.message : t('categorySearchFailed');
        failedSearch = job;
      }
    } finally {
      releaseSearchFlight(job);
    }
  }

  function scheduleTwitchSearch(query: string): void {
    resetCategorySearch();
    const requested = query.trim();
    state.twitchSearchFor = requested;
    search.twitchSearching = requested.length >= 2;
    if (search.twitchSearching) {
      const job: SearchJob = { generation: searchGeneration, query: requested };
      searchTimer = later(() => {
        searchTimer = null;
        fireAndForget(runSearch(job));
      }, 250);
    }
  }

  let disposed = false;
  const timers = new Set<number>();
  function cancelTimer(id: number): void {
    window.clearTimeout(id);
    timers.delete(id);
  }
  function later(callback: () => void, delay: number): number {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) {
        callback();
      }
    }, delay);
    timers.add(id);
    return id;
  }
  function taskGuard(): () => boolean {
    const generation = connectionGeneration;
    const operation = operationGeneration;
    return () =>
      !disposed && generation === connectionGeneration && operation === operationGeneration;
  }
  function resetBusy(): void {
    state.allSaving = false;
    state.runningPresetId = null;
    state.loadingTwitch = false;
  }

  /**
   * Запускает фоновую задачу, которая обрабатывает собственные ошибки сама
   * (try/catch внутри) и не должна прерывать контроллер при сбое.
   */
  function fireAndForget(operation: Promise<void>): void {
    operation.catch(() => {
      /* Ожидаемо: фоновые задачи не бросают наружу, кроме непредвиденных сбоев. */
    });
  }
  function markDirty(): void {
    state.allDirty = true;
    state.allSaveResult = null;
  }
  function setSubtitle(value: string): void {
    state.templateDraft.subtitle = value;
    state.subtitleDirty = true;
    if (state.allForm) {
      state.allForm.subtitle = value;
      if (settings.twitchEnabled) {
        state.allForm.twitchTitleMode = 'subtitle';
      }
      markDirty();
    }
  }
  function setTitle(value: string): void {
    if (state.allForm) {
      state.allForm.twitchTitle = value;
      markDirty();
    }
  }
  function setEnabled(value: boolean): void {
    if (!busy()) {
      settings.twitchEnabled = value;
      state.settingsDraft.twitchEnabled = value;
      saveSettings();
    }
  }
  function setTemplate(value: string): void {
    state.templateDraft.twitchTemplate = value;
    updateTemplatesDirty();
    markDirty();
  }
  function resetTemplates(): void {
    setTemplate(DEFAULT_TWITCH_TEMPLATE);
  }
  function setCategoryQuery(value: string, composing = false): void {
    if (state.allForm) {
      state.allForm.twitchCategoryQuery = value;
    }
    markDirty();
    if (!composing) {
      scheduleTwitchSearch(value);
    }
  }
  function setTagDraft(value: string): void {
    if (state.allForm) {
      state.allForm.twitchTagDraft = value;
      markDirty();
    }
  }
  function removeTag(index: number): void {
    state.allForm?.twitchTags.splice(index, 1);
    markDirty();
  }
  function retrySearch(): void {
    if (failedSearch && !search.twitchSearching) {
      search.searchError = null;
      search.twitchSearching = true;
      fireAndForget(runSearch(failedSearch));
    }
  }
  function moreCategories(): void {
    if (search.twitchSearching) {
      return;
    }
    if (
      rankCategories(state.twitchResults, state.twitchSearchFor).length > search.visibleCategories
    ) {
      search.visibleCategories += 20;
    } else if (search.searchHasMore && search.searchCursor) {
      search.twitchSearching = true;
      search.searchError = null;
      fireAndForget(
        runSearch({
          cursor: search.searchCursor,
          generation: searchGeneration,
          query: state.twitchSearchFor,
        }),
      );
    }
  }
  function openSettings(): void {
    state.settingsDraft = { ...settings };
    state.modal = 'settings';
  }
  function closeSettings(): void {
    state.modal = null;
  }
  function saveConnection(): void {
    const draft = state.settingsDraft;
    const next = {
      endpoint: draft.endpoint.trim() || '/',
      host: draft.host.trim(),
      password: draft.password,
      port: Math.max(1, Math.min(65_535, Number(draft.port) || 8080)),
      rememberPassword: draft.rememberPassword,
    };
    const connectionChanged =
      next.host !== settings.host ||
      next.port !== settings.port ||
      next.endpoint !== settings.endpoint ||
      next.password !== settings.password;
    Object.assign(settings, next);
    saveSettings();
    closeSettings();
    if (connectionChanged || state.connection !== 'connected') {
      fireAndForget(connect());
    }
  }
  function onVisibility(): void {
    if (document.visibilityState === 'visible') {
      fireAndForget(refreshState(false));
    }
  }
  function start(): void {
    if (demoMode) {
      enableDemoMode();
      initializeEditor();
      return;
    }
    document.addEventListener('visibilitychange', onVisibility);
    pollingId = window.setInterval(onVisibility, 30_000);
    fireAndForget(connect());
  }
  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    connectionGeneration += 1;
    stateRevision += 1;
    resetCategorySearch();
    rejectPendingRequests();
    for (const id of timers) {
      window.clearTimeout(id);
    }
    timers.clear();
    if (pollingId !== null) {
      window.clearInterval(pollingId);
    }
    pollingId = null;
    document.removeEventListener('visibilitychange', onVisibility);
    const previous = client;
    client = null;
    previous?.disconnect().catch(() => undefined);
  }

  const streamInfo: StreamInfo = {
    addTag: () => addTag('all-twitch'),
    busy,
    cardStatus,
    chooseCategory: (id: string) => chooseCategory('twitch', 'all-twitch', id),
    closeNotice,
    closeSettings,
    connect,
    connectionText,
    demoMode,
    dispose,
    errors: () => (state.allForm ? validateAll(state.allForm) : []),
    moreCategories,
    openSettings,
    platformAvailable,
    platformLoading,
    refreshState,
    removeTag,
    resetCategorySearch,
    resetTemplates,
    retrySearch,
    runPreset,
    saveAll,
    saveConnection,
    search,
    setCategoryQuery,
    setEnabled,
    setSubtitle,
    setTagDraft,
    setTemplate,
    setTitle,
    settings,
    start,
    state,
    title: () => (state.allForm ? inlineTitle('twitch', state.allForm) : ''),
    verifyAction,
    version: APP_VERSION,
  };

  return streamInfo;
}

export interface StreamInfo {
  addTag: () => void;
  busy: () => boolean;
  cardStatus: (platform: Platform) => 'live' | 'offline' | 'disconnected';
  chooseCategory: (id: string) => void;
  closeNotice: (id: string) => void;
  closeSettings: () => void;
  connect: () => Promise<void>;
  connectionText: () => string;
  demoMode: boolean;
  dispose: () => void;
  errors: () => string[];
  moreCategories: () => void;
  openSettings: () => void;
  platformAvailable: (platform: Platform) => boolean;
  platformLoading: (platform: Platform) => boolean;
  refreshState: (showError?: boolean) => Promise<void>;
  removeTag: (index: number) => void;
  resetCategorySearch: () => void;
  resetTemplates: () => void;
  retrySearch: () => void;
  runPreset: (id: string, name: string) => Promise<void>;
  saveAll: () => Promise<void>;
  saveConnection: () => void;
  search: SearchStatus;
  setCategoryQuery: (value: string, composing?: boolean) => void;
  setEnabled: (value: boolean) => void;
  setSubtitle: (value: string) => void;
  setTagDraft: (value: string) => void;
  setTemplate: (value: string) => void;
  setTitle: (value: string) => void;
  settings: ConnectionSettings;
  start: () => void;
  state: AppState;
  title: () => string;
  verifyAction: () => Promise<void>;
  version: string;
}
