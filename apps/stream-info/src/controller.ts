import { type StreamerbotAction, StreamerbotClient } from '@streamerbot/client';
import packageJson from '../package.json';
import { rankCategories } from './category-search';
import { t } from './messages';
import { reactive } from './reactive';
import {
  DEFAULT_TWITCH_TEMPLATE,
  DEFAULT_YOUTUBE_TEMPLATE,
  isTemplateValid,
  migrateTemplateToken,
  titleFromTemplate,
} from './templates';
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
  YouTubeState,
} from './types';

const API_VERSION = 6;
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
  youtubeTemplate: string;
}

interface TwitchUpdatePayload extends Record<string, unknown> {
  categoryId?: string;
  tags?: string[];
  title?: string;
}

interface YouTubeUpdatePayload extends Record<string, unknown> {
  categoryName?: string;
  tags?: string[];
  title?: string;
}

interface CommandPayloads {
  getState: Record<string, never>;
  saveTemplates: { subtitle: string; twitchTemplate: string; youtubeTemplate: string };
  searchTwitchCategories: { query: string; cursor?: string };
  updateTwitch: TwitchUpdatePayload;
  updateYouTube: YouTubeUpdatePayload;
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
  loadingYouTube: boolean;
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
  youtubeEnabled: true,
  youtubeTemplate: DEFAULT_YOUTUBE_TEMPLATE,
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
      // The current dock always targets both platforms; old saved switches are
      // intentionally ignored so a stale false value cannot hide a platform.
      twitchEnabled: true,
      twitchTemplate:
        typeof saved.twitchTemplate === 'string' ? saved.twitchTemplate : defaults.twitchTemplate,
      youtubeEnabled: true,
      youtubeTemplate:
        typeof saved.youtubeTemplate === 'string'
          ? saved.youtubeTemplate
          : defaults.youtubeTemplate,
    };
  } catch {
    return { ...defaults };
  }
}
function restoreTemplateDraft(): Pick<TemplateDraft, 'twitchTemplate' | 'youtubeTemplate'> | null {
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(TEMPLATE_DRAFT_KEY) ?? 'null');
    if (typeof draft !== 'object' || draft === null || !('twitchTemplate' in draft)) {
      return null;
    }
    if (typeof draft.twitchTemplate !== 'string') {
      return null;
    }
    return {
      twitchTemplate: migrateTemplateToken(draft.twitchTemplate),
      youtubeTemplate:
        'youtubeTemplate' in draft && typeof draft.youtubeTemplate === 'string'
          ? migrateTemplateToken(draft.youtubeTemplate)
          : DEFAULT_YOUTUBE_TEMPLATE,
    };
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
    cardEffects: { twitch: null, youtube: null },
    cardErrors: { twitch: false, youtube: false },
    connection: 'connecting',
    connectionError: null,
    importCopied: false,
    lastUpdated: null,
    loadingTwitch: false,
    loadingYouTube: false,
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
      youtubeTemplate: recoveredDraft?.youtubeTemplate ?? settings.youtubeTemplate,
    },
    templatesDirty:
      recoveredDraft !== null &&
      (recoveredDraft.twitchTemplate !== settings.twitchTemplate ||
        recoveredDraft.youtubeTemplate !== settings.youtubeTemplate),
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
        twitchTemplate: '🔴 $s | !tg !yt !tw !donate',
        youtubeTemplate: '🔴 $g | $s | !tg !yt !tw !donate',
      },
      twitch: {
        // Значение повторяет реальный ответ Streamer.bot: display name канала.
        accountName: 'MASEAAAO',
        categoryId: '493057',
        categoryImageUrl: '',
        categoryName: 'PUBG: BATTLEGROUNDS',
        connected: true,
        live: true,
        login: 'maseaaao',
        tags: ['PUBG', 'Ranked', 'RU'],
        title: 'Ranked grind — road to Diamond',
      },
      youtube: {
        accountName: 'Maseaaao Live',
        broadcastId: 'demo-broadcast',
        categoryId: '20',
        categoryName: 'Видеоигры',
        channelId: 'demo-channel',
        connected: true,
        live: true,
        status: 'live',
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
      youtubeTemplate: stream.templates.youtubeTemplate,
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

  function platformEnabled(platform: Platform): boolean {
    return platform === 'twitch' ? settings.twitchEnabled : settings.youtubeEnabled;
  }

  function platformAvailable(platform: Platform): boolean {
    const { stream } = state;
    if (!(platformEnabled(platform) && stream)) {
      return false;
    }
    if (platform === 'twitch') {
      return stream.twitch.connected;
    }
    // Streamer.bot can write YouTube metadata only to a live broadcast.
    return Boolean(stream.youtube.connected && stream.youtube.live && stream.youtube.broadcastId);
  }

  function platformLoading(platform: Platform): boolean {
    return platform === 'twitch' ? state.loadingTwitch : state.loadingYouTube;
  }

  function busy(): boolean {
    return state.allSaving || platformLoading('twitch') || platformLoading('youtube');
  }

  function inlineTitle(platform: Platform, form: AllForm): string {
    const mode = platform === 'twitch' ? form.twitchTitleMode : form.youtubeTitleMode;
    const title = platform === 'twitch' ? form.twitchTitle : form.youtubeTitle;
    const template =
      platform === 'twitch'
        ? state.templateDraft.twitchTemplate
        : state.templateDraft.youtubeTemplate;
    const gameName = form.twitchCategory?.name || state.stream?.twitch.categoryName || '';
    return mode === 'subtitle'
      ? titleFromTemplate(template, form.subtitle, gameName)
      : title.trim();
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
    const youtubeRaw = isRecord(data.youtube) ? data.youtube : {};
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
    const youtube: YouTubeState = {
      accountName: textValue(youtubeRaw.accountName),
      broadcastId: textValue(youtubeRaw.broadcastId),
      categoryId: textValue(youtubeRaw.categoryId),
      categoryName: textValue(youtubeRaw.categoryName),
      channelId: textValue(youtubeRaw.channelId),
      connected: youtubeRaw.connected === true,
      live: youtubeRaw.live === true,
      status: textValue(youtubeRaw.status),
      tags: asStringArray(youtubeRaw.tags),
      title: textValue(youtubeRaw.title),
    };
    return { apiVersion: Number(data.apiVersion ?? API_VERSION), templates, twitch, youtube };
  }

  function normalizeTemplates(value: unknown): TemplateState {
    const raw = isRecord(value) ? value : {};
    return {
      configured: raw.configured === true,
      subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : '',
      twitchTemplate:
        typeof raw.twitchTemplate === 'string' && raw.twitchTemplate
          ? migrateTemplateToken(raw.twitchTemplate)
          : DEFAULT_TWITCH_TEMPLATE,
      youtubeTemplate:
        typeof raw.youtubeTemplate === 'string' && raw.youtubeTemplate
          ? migrateTemplateToken(raw.youtubeTemplate)
          : DEFAULT_YOUTUBE_TEMPLATE,
    };
  }

  function updateTemplatesDirty(): void {
    state.templatesDirty =
      state.templateDraft.twitchTemplate !== settings.twitchTemplate ||
      state.templateDraft.youtubeTemplate !== settings.youtubeTemplate;
    try {
      if (state.templatesDirty) {
        sessionStorage.setItem(
          TEMPLATE_DRAFT_KEY,
          JSON.stringify({
            twitchTemplate: state.templateDraft.twitchTemplate,
            youtubeTemplate: state.templateDraft.youtubeTemplate,
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
      settings.twitchTemplate !== DEFAULT_TWITCH_TEMPLATE ||
      settings.youtubeTemplate !== DEFAULT_YOUTUBE_TEMPLATE ||
      Boolean(settings.lastSubtitle);
    if (!templates.configured && hasLocalCustomTemplate) {
      return;
    }
    Object.assign(settings, {
      lastSubtitle: templates.subtitle,
      twitchTemplate: templates.twitchTemplate,
      youtubeTemplate: templates.youtubeTemplate,
    });
    saveSettings();
    if (!(preserveDraft || state.templatesDirty || state.subtitleDirty)) {
      state.templateDraft = {
        subtitle: templates.subtitle,
        twitchTemplate: templates.twitchTemplate,
        youtubeTemplate: templates.youtubeTemplate,
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
    const { twitchTemplate, youtubeTemplate } = state.templateDraft;
    if (
      value === settings.lastSubtitle &&
      twitchTemplate === settings.twitchTemplate &&
      youtubeTemplate === settings.youtubeTemplate
    ) {
      state.subtitleDirty = false;
      return true;
    }
    if (disposed || !client?.ready || !state.action) {
      return false;
    }
    try {
      const response = await callAction('saveTemplates', {
        subtitle: value,
        twitchTemplate,
        youtubeTemplate,
      });
      if (!current()) {
        return false;
      }
      if (!response.ok) {
        throw new Error(response.error?.message ?? t('subtitleStateSaveFailed'));
      }
      settings.lastSubtitle = value;
      settings.twitchTemplate = twitchTemplate;
      settings.youtubeTemplate = youtubeTemplate;
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
    const twitchTags = asStringArray(state.stream.twitch.tags);
    const youtubeTags = asStringArray(state.stream.youtube.tags);
    state.allForm = {
      subtitle: state.templateDraft.subtitle,
      tagDraft: previous?.tagDraft ?? '',
      tags: twitchTags.length ? [...twitchTags] : [...youtubeTags],
      twitchCategory: categoryFromState('twitch'),
      twitchCategoryQuery: '',
      twitchTitle: state.stream.twitch.title ?? '',
      twitchTitleMode: previous?.twitchTitleMode ?? 'subtitle',
      youtubeCategoryName: state.stream.youtube.categoryName || 'Видеоигры',
      youtubeTitle: state.stream.youtube.title ?? '',
      youtubeTitleMode: previous?.youtubeTitleMode ?? 'subtitle',
    };
    if (previous && (!settings.twitchEnabled || preservePlatforms.includes('twitch'))) {
      state.allForm.twitchTitle = previous.twitchTitle;
      state.allForm.twitchCategory = previous.twitchCategory;
      state.allForm.twitchCategoryQuery = previous.twitchCategoryQuery;
      state.allForm.twitchTitleMode = previous.twitchTitleMode;
    }
    if (previous && (!settings.youtubeEnabled || preservePlatforms.includes('youtube'))) {
      state.allForm.youtubeTitle = previous.youtubeTitle;
      state.allForm.youtubeCategoryName = previous.youtubeCategoryName;
      state.allForm.youtubeTitleMode = previous.youtubeTitleMode;
    }
    if (previous) {
      state.allForm.tags = previous.tags;
      state.allForm.tagDraft = previous.tagDraft;
    }
  }

  function tagsEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }

  function validateTwitchTitle(title: string): string[] {
    const errors: string[] = [];
    if (!title.trim()) {
      errors.push(t('twitchTitleRequired'));
    }
    if (title.length > 140) {
      errors.push(t('twitchTitleTooLong'));
    }
    return errors;
  }

  function validateYouTubeTitle(title: string): string[] {
    const errors: string[] = [];
    if (!title.trim()) {
      errors.push(t('youtubeTitleRequired'));
    }
    if (title.length > 100) {
      errors.push(t('youtubeTitleTooLong'));
    }
    if (title.includes('<') || title.includes('>')) {
      errors.push(t('youtubeTitleInvalid'));
    }
    return errors;
  }

  function validateSharedTags(tags: string[]): string[] {
    const errors: string[] = [];
    if (tags.length > 10) {
      errors.push(t('twitchTagsTooMany'));
    }
    if (tags.some((tag) => !tag.trim() || tag.length > 25 || SPACED_TAG.test(tag))) {
      errors.push(t('twitchTagsInvalid'));
    }
    if (new Set(tags.map((tag) => tag.toLocaleLowerCase('ru-RU'))).size !== tags.length) {
      errors.push(t('twitchTagsDuplicate'));
    }
    if (tags.join(',').length > 500) {
      errors.push(t('youtubeTagsTooLong'));
    }
    return errors;
  }

  function validateAll(form: AllForm): string[] {
    const messages: string[] = [];
    const anyAvailable = platformAvailable('twitch') || platformAvailable('youtube');
    if (platformAvailable('twitch') && form.twitchCategoryQuery.trim()) {
      messages.push(t('categorySelectionRequired', { platform: 'Twitch' }));
    }
    if (platformAvailable('youtube') && !form.youtubeCategoryName.trim()) {
      messages.push(t('categorySelectionRequired', { platform: 'YouTube' }));
    }
    if (!isTemplateValid(state.templateDraft.twitchTemplate)) {
      messages.push(t('twitchTemplateValidation'));
    }
    if (!isTemplateValid(state.templateDraft.youtubeTemplate)) {
      messages.push(t('youtubeTemplateValidation'));
    }
    if (anyAvailable) {
      messages.push(...validateSharedTags(form.tags));
    }
    if (platformAvailable('twitch')) {
      messages.push(...validateTwitchTitle(inlineTitle('twitch', form)));
    }
    if (platformAvailable('youtube')) {
      messages.push(...validateYouTubeTitle(inlineTitle('youtube', form)));
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

  function fieldsToLines(fields: unknown, platform: Platform): string[] {
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
    return lines.length
      ? lines
      : [t(platform === 'twitch' ? 'twitchChangesFailed' : 'youtubeChangesFailed')];
  }

  function platformLabel(platform: Platform): string {
    return platform === 'twitch' ? 'Twitch' : 'YouTube';
  }

  function setPlatformLoading(platform: Platform, value: boolean): void {
    if (platform === 'twitch') {
      state.loadingTwitch = value;
    } else {
      state.loadingYouTube = value;
    }
  }

  function sendPlatformUpdate(
    platform: Platform,
    payload: TwitchUpdatePayload | YouTubeUpdatePayload,
  ): Promise<ActionResponse> {
    return platform === 'twitch'
      ? callAction('updateTwitch', payload as TwitchUpdatePayload)
      : callAction('updateYouTube', payload as YouTubeUpdatePayload);
  }

  function updateFailureLines(response: ActionResponse, platform: Platform): string[] {
    const lines = fieldsToLines(response.data?.fields, platform);
    const errorMessage =
      isRecord(response.data) && typeof response.data.error === 'string'
        ? response.data.error
        : null;
    return errorMessage ? [...lines, errorMessage] : lines;
  }

  async function updatePlatform(
    platform: Platform,
    payload: TwitchUpdatePayload | YouTubeUpdatePayload,
  ): Promise<boolean> {
    const current = taskGuard();
    if (!Object.keys(payload).length) {
      return true;
    }
    setPlatformLoading(platform, true);
    try {
      const response = await sendPlatformUpdate(platform, payload);
      if (!current()) {
        return false;
      }
      flashCard(platform, response.ok);
      if (!response.ok) {
        notify(t('updateFailed', { platform: platformLabel(platform) }), [
          ...updateFailureLines(response, platform),
        ]);
      }
      await refreshState(false);
      return response.ok;
    } catch (error) {
      if (!current()) {
        return false;
      }
      flashCard(platform, false);
      notify(t('updateFailed', { platform: platformLabel(platform) }), [
        error instanceof Error ? error.message : t('unknownError'),
      ]);
      await refreshState(false);
      return false;
    } finally {
      if (current()) {
        setPlatformLoading(platform, false);
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
    if (!tagsEqual(form.tags, asStringArray(stream.twitch.tags))) {
      payload.tags = form.tags;
    }
    return payload;
  }

  /** Собирает отличия формы YouTube от опубликованного состояния. */
  function buildYouTubePayload(form: AllForm, stream: StreamState): YouTubeUpdatePayload {
    const payload: YouTubeUpdatePayload = {};
    if (!platformAvailable('youtube')) {
      return payload;
    }
    const youtubeTitle = inlineTitle('youtube', form);
    if (youtubeTitle !== stream.youtube.title) {
      payload.title = youtubeTitle;
    }
    if (form.youtubeCategoryName && form.youtubeCategoryName !== stream.youtube.categoryName) {
      payload.categoryName = form.youtubeCategoryName;
    }
    if (!tagsEqual(form.tags, asStringArray(stream.youtube.tags))) {
      payload.tags = form.tags;
    }
    return payload;
  }

  /** Отличает неотправленные правки платформы после успешного сохранения. */
  function hasPendingEdits(platform: Platform, form: AllForm, stream: StreamState): boolean {
    const published = stream[platform];
    if (platform === 'twitch') {
      const category = form.twitchCategory;
      return (
        inlineTitle('twitch', form) !== published.title ||
        (category !== null && category.id !== published.categoryId) ||
        !tagsEqual(form.tags, asStringArray(published.tags)) ||
        form.twitchCategoryQuery.trim().length > 0
      );
    }
    return (
      inlineTitle('youtube', form) !== published.title ||
      (form.youtubeCategoryName !== '' && form.youtubeCategoryName !== published.categoryName) ||
      !tagsEqual(form.tags, asStringArray(published.tags))
    );
  }

  /** По успешным сохранениям восстанавливает редактор и помечает остаточные правки. */
  function applySaveResults(form: AllForm, stream: StreamState, results: boolean[]): void {
    if (!results.every(Boolean)) {
      return;
    }
    const platforms: Platform[] = ['twitch', 'youtube'];
    const preserved = platforms.filter((platform) => !platformAvailable(platform));
    const pending =
      preserved.some((platform) => hasPendingEdits(platform, form, stream)) ||
      Boolean(form.tagDraft.trim());
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

  interface SaveJob {
    payload: TwitchUpdatePayload | YouTubeUpdatePayload;
    platform: Platform;
  }

  function buildSaveJobs(form: AllForm, stream: StreamState): SaveJob[] {
    const jobs: SaveJob[] = [];
    const twitchPayload = buildTwitchPayload(form, stream);
    if (Object.keys(twitchPayload).length) {
      jobs.push({ payload: twitchPayload, platform: 'twitch' });
    }
    const youtubePayload = buildYouTubePayload(form, stream);
    if (Object.keys(youtubePayload).length) {
      jobs.push({ payload: youtubePayload, platform: 'youtube' });
    }
    return jobs;
  }

  async function runSaveJobs(jobs: SaveJob[], current: () => boolean): Promise<boolean[] | null> {
    const results: boolean[] = [];
    for (const job of jobs) {
      // biome-ignore lint/performance/noAwaitInLoops: provider writes are intentionally sequential.
      results.push(await updatePlatform(job.platform, job.payload));
      if (!current()) {
        return null;
      }
    }
    return results;
  }

  function canStartSave(form: AllForm, templatesChanged: boolean): boolean {
    const anyAvailable = platformAvailable('twitch') || platformAvailable('youtube');
    return (anyAvailable || templatesChanged) && !busy() && validateAll(form).length === 0;
  }

  function notifyNoSaveJobs(templatesChanged: boolean): void {
    if (templatesChanged) {
      notify(t('templateSaved'), [t('templateSavedDescription')], 'success');
    } else {
      notify(t('unchanged'), [t('unchangedDescription')], 'info');
    }
  }

  async function saveAll(): Promise<void> {
    const current = taskGuard();
    const { allForm: form, stream } = state;
    if (!(form && stream)) {
      return;
    }
    const templatesChanged = state.templatesDirty || form.subtitle.trim() !== settings.lastSubtitle;
    if (!canStartSave(form, templatesChanged)) {
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
      const jobs = buildSaveJobs(form, stream);
      if (!jobs.length) {
        notifyNoSaveJobs(templatesChanged);
      }
      const results = await runSaveJobs(jobs, current);
      if (!results) {
        return;
      }
      applySaveResults(form, stream, results);
    } finally {
      if (current()) {
        state.allSaving = false;
      }
    }
  }

  function addTag(): void {
    const form = state.allForm;
    if (!form) {
      return;
    }
    markDirty();
    const value = form.tagDraft.trim();
    if (!value) {
      return;
    }
    if (!form.tags.some((tag) => tag.localeCompare(value, 'ru', { sensitivity: 'accent' }) === 0)) {
      form.tags.push(value);
    }
    form.tagDraft = '';
  }

  function chooseCategory(id: string): void {
    const category = state.twitchResults.find((item) => item.id === id);
    if (!(category && state.allForm)) {
      return;
    }
    state.allForm.twitchCategory = category;
    state.allForm.twitchCategoryQuery = '';
    markDirty();
    resetCategorySearch();
  }

  function setYouTubeCategory(name: string): void {
    if (state.allForm) {
      state.allForm.youtubeCategoryName = name;
      markDirty();
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
    state.loadingYouTube = false;
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
      markDirty();
    }
  }
  function setTitle(platform: Platform, value: string): void {
    if (state.allForm) {
      if (platform === 'twitch') {
        state.allForm.twitchTitle = value;
      } else {
        state.allForm.youtubeTitle = value;
      }
      markDirty();
    }
  }
  function setTitleMode(platform: Platform, value: 'subtitle' | 'full'): void {
    if (state.allForm) {
      if (platform === 'twitch') {
        state.allForm.twitchTitleMode = value;
      } else {
        state.allForm.youtubeTitleMode = value;
      }
      markDirty();
    }
  }
  function setEnabled(platform: Platform, value: boolean): void {
    if (!busy()) {
      if (platform === 'twitch') {
        settings.twitchEnabled = value;
        state.settingsDraft.twitchEnabled = value;
      } else {
        settings.youtubeEnabled = value;
        state.settingsDraft.youtubeEnabled = value;
      }
      saveSettings();
    }
  }
  function setTemplate(platform: Platform, value: string): void {
    if (platform === 'twitch') {
      state.templateDraft.twitchTemplate = value;
    } else {
      state.templateDraft.youtubeTemplate = value;
    }
    updateTemplatesDirty();
    markDirty();
  }
  function resetTemplates(platform: Platform): void {
    setTemplate(
      platform,
      platform === 'twitch' ? DEFAULT_TWITCH_TEMPLATE : DEFAULT_YOUTUBE_TEMPLATE,
    );
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
      state.allForm.tagDraft = value;
      markDirty();
    }
  }
  function removeTag(index: number): void {
    state.allForm?.tags.splice(index, 1);
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
    addTag,
    busy,
    cardStatus,
    chooseCategory,
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
    setTitleMode,
    settings,
    setYouTubeCategory,
    start,
    state,
    title: (platform: Platform) => (state.allForm ? inlineTitle(platform, state.allForm) : ''),
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
  resetTemplates: (platform: Platform) => void;
  retrySearch: () => void;
  runPreset: (id: string, name: string) => Promise<void>;
  saveAll: () => Promise<void>;
  saveConnection: () => void;
  search: SearchStatus;
  setCategoryQuery: (value: string, composing?: boolean) => void;
  setEnabled: (platform: Platform, value: boolean) => void;
  setSubtitle: (value: string) => void;
  setTagDraft: (value: string) => void;
  setTemplate: (platform: Platform, value: string) => void;
  setTitle: (platform: Platform, value: string) => void;
  setTitleMode: (platform: Platform, value: 'subtitle' | 'full') => void;
  settings: ConnectionSettings;
  setYouTubeCategory: (name: string) => void;
  start: () => void;
  state: AppState;
  title: (platform: Platform) => string;
  verifyAction: () => Promise<void>;
  version: string;
}
