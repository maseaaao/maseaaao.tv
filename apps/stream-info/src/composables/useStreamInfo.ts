import { reactive, computed, onMounted, onScopeDispose } from 'vue';
import { StreamerbotClient } from '@streamerbot/client';
import packageJson from '../../package.json';
import { rankCategories } from '../category-search';
import { DEFAULT_TWITCH_TEMPLATE, isTemplateValid, titleFromTemplate } from '../templates';
import { t } from '../messages';
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
} from '../types';

const API_VERSION = 4;
const APP_VERSION = packageJson.version;
const ACTION_GROUP = 'STREAM INFO';
const ACTION_NAME = 'STREAM INFO | API';
const CODE_EVENT = 'stream_info_api_response';
const STORAGE_KEY = 'change-info-streamer-bot.settings.v1';
const TEMPLATE_DRAFT_KEY = 'change-info-streamer-bot.template-draft.v1';
const REQUEST_TIMEOUT = 15_000;

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type ActionStatus = 'unknown' | 'ready' | 'missing' | 'disabled' | 'outdated';
type Modal = 'settings' | null;
type CardEffect = 'success' | 'flash-error' | null;

type NoticeKind = 'info' | 'warning' | 'error' | 'success';

export interface Notice {
  id: string;
  title: string;
  lines: string[];
  kind: NoticeKind;
}

interface TemplateDraft {
  twitchTemplate: string;
  subtitle: string;
}

interface PresetAction extends ActionSummary {
  label: string;
}

interface TwitchUpdatePayload extends Record<string, unknown> {
  title?: string;
  categoryId?: string;
  tags?: string[];
}

type CommandPayloads = {
  getState: Record<string, never>;
  saveTemplates: { twitchTemplate: string; subtitle: string };
  updateTwitch: TwitchUpdatePayload;
  searchTwitchCategories: { query: string; cursor?: string };
};

interface AppState {
  connection: ConnectionStatus;
  connectionError: string | null;
  authNeeded: boolean;
  actionStatus: ActionStatus;
  action: ActionSummary | null;
  stream: StreamState | null;
  modal: Modal;
  settingsDraft: ConnectionSettings;
  templateDraft: TemplateDraft;
  presetActions: PresetAction[];
  runningPresetId: string | null;
  templatesSaving: boolean;
  templatesDirty: boolean;
  allSaving: boolean;
  subtitleDirty: boolean;
  allDirty: boolean;
  allSaveResult: 'saved' | 'partial' | null;
  allForm: AllForm | null;
  twitchResults: TwitchCategory[];
  twitchSearchFor: string;
  loadingPlatforms: Set<Platform>;
  cardEffects: Record<Platform, CardEffect>;
  cardErrors: Record<Platform, boolean>;
  notices: Notice[];
  showImport: boolean;
  importCopied: boolean;
  lastUpdated: Date | null;
}

const defaults: ConnectionSettings = {
  host: '127.0.0.1',
  port: 8080,
  endpoint: '/',
  password: '',
  rememberPassword: false,
  twitchTemplate: DEFAULT_TWITCH_TEMPLATE,
  lastSubtitle: '',
  twitchEnabled: true,
};

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
    if (!isRecord(saved)) return { ...defaults };
    return {
      host: typeof saved.host === 'string' ? saved.host : defaults.host,
      port:
        typeof saved.port === 'number' && Number.isFinite(saved.port) ? saved.port : defaults.port,
      endpoint: typeof saved.endpoint === 'string' ? saved.endpoint : defaults.endpoint,
      rememberPassword: saved.rememberPassword === true,
      password:
        saved.rememberPassword === true && typeof saved.password === 'string' ? saved.password : '',
      twitchTemplate:
        typeof saved.twitchTemplate === 'string' ? saved.twitchTemplate : defaults.twitchTemplate,
      lastSubtitle: typeof saved.lastSubtitle === 'string' ? saved.lastSubtitle : '',
      twitchEnabled: saved.twitchEnabled !== false,
    };
  } catch {
    return { ...defaults };
  }
}
function restoreTemplateDraft(): Pick<TemplateDraft, 'twitchTemplate'> | null {
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(TEMPLATE_DRAFT_KEY) ?? 'null');
    if (typeof draft !== 'object' || draft === null || !('twitchTemplate' in draft)) return null;
    if (typeof draft.twitchTemplate !== 'string') return null;
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
  )
    return null;
  if (value.data !== null && !isRecord(value.data)) return null;
  if (value.error !== null && (!isRecord(value.error) || typeof value.error.message !== 'string'))
    return null;
  return {
    requestId: value.requestId,
    apiVersion: value.apiVersion,
    command: value.command,
    ok: value.ok,
    data: value.data,
    error:
      isRecord(value.error) && typeof value.error.message === 'string'
        ? { message: value.error.message }
        : null,
  };
}

export function useStreamInfo(options: { demo?: boolean } = {}) {
  const demoMode = options.demo ?? new URLSearchParams(window.location.search).has('demo');
  const settings = reactive(loadSettings());
  const recoveredDraft = restoreTemplateDraft();
  const state = reactive<AppState>({
    connection: 'connecting',
    connectionError: null,
    authNeeded: false,
    actionStatus: 'unknown',
    action: null,
    stream: null,
    modal: null,
    settingsDraft: { ...settings },
    templateDraft: {
      twitchTemplate: recoveredDraft?.twitchTemplate ?? settings.twitchTemplate,
      subtitle: settings.lastSubtitle,
    },
    presetActions: [],
    runningPresetId: null,
    templatesSaving: false,
    templatesDirty:
      recoveredDraft !== null && recoveredDraft.twitchTemplate !== settings.twitchTemplate,
    allSaving: false,
    subtitleDirty: false,
    allDirty: false,
    allSaveResult: null,
    allForm: null,
    twitchResults: [],
    twitchSearchFor: '',
    loadingPlatforms: new Set(),
    cardEffects: { twitch: null },
    cardErrors: { twitch: false },
    notices: [],
    showImport: false,
    importCopied: false,
    lastUpdated: null,
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
    state.notices.unshift({ id: uuid(), title, lines, kind });
  }

  function closeNotice(id: string): void {
    state.notices = state.notices.filter((notice) => notice.id !== id);
  }

  function enableDemoMode(): void {
    const stream: StreamState = {
      apiVersion: API_VERSION,
      twitch: {
        connected: true,
        live: true,
        accountName: 'Maseaaao',
        login: 'maseaaao',
        title: 'Ranked grind — road to Diamond',
        categoryId: '493057',
        categoryName: 'PUBG: BATTLEGROUNDS',
        categoryImageUrl: '',
        tags: ['PUBG', 'Ranked', 'RU'],
      },
      templates: {
        twitchTemplate: '🔴 %subtitle% | !tg !yt !tw !donate',
        subtitle: 'Ranked with chat',
        configured: true,
      },
    };
    state.connection = 'connected';
    state.actionStatus = 'ready';
    state.action = { id: 'demo-action', name: ACTION_NAME, group: ACTION_GROUP, enabled: true };
    state.stream = stream;
    state.templateDraft = {
      twitchTemplate: stream.templates.twitchTemplate,
      subtitle: stream.templates.subtitle,
    };
    state.presetActions = [
      { id: 'demo-pubg', name: 'PRESET | PUBG', group: ACTION_GROUP, enabled: true, label: 'PUBG' },
      {
        id: 'demo-just-chatting',
        name: 'PRESET | Just Chatting',
        group: ACTION_GROUP,
        enabled: true,
        label: 'Just Chatting',
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
    query: string;
    generation: number;
    cursor?: string;
  }
  let searchFlight: SearchJob | null = null;
  let queuedSearch: SearchJob | null = null;
  function resetCategorySearch(): void {
    ++searchGeneration;
    if (searchTimer !== null) cancelTimer(searchTimer);
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
    if (state.connection === 'connected') return t('connectionConnected');
    if (state.connection === 'connecting') return t('connectionConnecting');
    return t('connectionDisconnected');
  }

  function cardStatus(platform: Platform): 'live' | 'offline' | 'disconnected' {
    const value = state.stream?.[platform];
    if (!value?.connected) return 'disconnected';
    return value.live ? 'live' : 'offline';
  }

  function platformEnabled(_platform: Platform): boolean {
    return settings.twitchEnabled;
  }

  function platformAvailable(platform: Platform): boolean {
    const stream = state.stream;
    return platformEnabled(platform) && Boolean(stream?.twitch.connected);
  }

  function editorBusy(): boolean {
    return state.allSaving || state.loadingPlatforms.size > 0;
  }

  function inlineTitle(_platform: Platform, form: AllForm): string {
    const mode = form.twitchTitleMode;
    const title = form.twitchTitle;
    const template = settings.twitchTemplate;
    return mode === 'subtitle' ? titleFromTemplate(template, form.subtitle) : title.trim();
  }

  function textValue(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  }

  function normalizeStream(data: Record<string, unknown>): StreamState {
    const twitchRaw = isRecord(data.twitch) ? data.twitch : {};
    const templates = normalizeTemplates(data.templates);
    const twitch: TwitchState = {
      connected: twitchRaw.connected === true,
      live: twitchRaw.live === true,
      accountName: textValue(twitchRaw.accountName),
      login: textValue(twitchRaw.login),
      broadcasterId: textValue(twitchRaw.broadcasterId),
      title: textValue(twitchRaw.title),
      categoryId: textValue(twitchRaw.categoryId),
      categoryName: textValue(twitchRaw.categoryName),
      categoryImageUrl: textValue(twitchRaw.categoryImageUrl),
      tags: asStringArray(twitchRaw.tags),
    };
    return { apiVersion: Number(data.apiVersion ?? API_VERSION), twitch, templates };
  }

  function normalizeTemplates(value: unknown): TemplateState {
    const raw = isRecord(value) ? value : {};
    return {
      twitchTemplate:
        typeof raw.twitchTemplate === 'string' && raw.twitchTemplate
          ? raw.twitchTemplate
          : DEFAULT_TWITCH_TEMPLATE,
      subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : '',
      configured: raw.configured === true,
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
    if (!templates.configured && hasLocalCustomTemplate) return;
    Object.assign(settings, {
      twitchTemplate: templates.twitchTemplate,
      lastSubtitle: templates.subtitle,
    });
    saveSettings();
    if (!preserveDraft && !state.templatesDirty && !state.subtitleDirty)
      state.templateDraft = {
        twitchTemplate: templates.twitchTemplate,
        subtitle: templates.subtitle,
      };
    updateTemplatesDirty();
  }

  function handleCodeEvent(payload: unknown): void {
    const root = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    if (!root || root.eventName !== CODE_EVENT || !isRecord(root.args)) return;
    if (typeof root.args.requestId !== 'string') return;
    const pending = requestResolvers.get(root.args.requestId);
    if (!pending || pending.generation !== connectionGeneration) return;
    const response = parseResponse(root.args);
    cancelTimer(pending.timer);
    requestResolvers.delete(root.args.requestId);
    if (response && response.command === pending.command) pending.resolve(response);
    else pending.reject(new Error(t('actionStateFailed')));
  }

  async function connect(): Promise<void> {
    if (disposed || demoMode) return;
    ++operationGeneration;
    resetBusy();
    const generation = ++connectionGeneration;
    const previous = client;
    client = null;
    actionCheckRunning = false;
    resetCategorySearch();
    state.connection = 'connecting';
    state.connectionError = null;
    rejectPendingRequests();
    if (previous) {
      try {
        await previous.disconnect();
      } catch {
        /* the old socket may already be closed */
      }
    }
    if (disposed || generation !== connectionGeneration) return;
    const next = new StreamerbotClient({
      host: settings.host,
      port: settings.port,
      endpoint: settings.endpoint || '/',
      password: settings.password || undefined,
      immediate: false,
      autoReconnect: true,
      retries: -1,
      logLevel: 'none',
      onConnect: () => {
        if (isCurrent()) void onConnected(generation);
      },
      onDisconnect: () => {
        if (!isCurrent()) return;
        ++operationGeneration;
        resetBusy();
        ++stateRevision;
        actionCheckRunning = false;
        resetCategorySearch();
        rejectPendingRequests();
        state.connection = 'disconnected';
        state.actionStatus = 'unknown';
        state.stream = null;
      },
      onError: (error: unknown) => {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : t('connectFailed');
        state.connectionError = message;
        state.connection = 'disconnected';
        state.authNeeded = /auth|password|credential/i.test(message);
      },
    });
    const isCurrent = () => !disposed && generation === connectionGeneration && client === next;
    client = next;
    try {
      await next.on('Custom.CodeEvent', (payload) => {
        if (isCurrent()) handleCodeEvent(payload);
      });
      if (!isCurrent()) return;
      await next.connect();
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : t('connectFailed');
      state.connection = 'disconnected';
      state.connectionError = message;
      state.authNeeded = /auth|password|credential/i.test(message) || Boolean(settings.password);
    }
  }

  async function onConnected(generation = connectionGeneration): Promise<void> {
    if (disposed || generation !== connectionGeneration) return;
    state.connection = 'connected';
    state.connectionError = null;
    state.authNeeded = false;
    await verifyAction();
    if (generation !== connectionGeneration || state.connection !== 'connected') return;
    if (state.allForm?.twitchCategoryQuery.trim())
      scheduleTwitchSearch(state.allForm.twitchCategoryQuery);
  }

  async function verifyAction(): Promise<void> {
    if (disposed || !client?.ready || actionCheckRunning) return;
    const owner = client;
    const generation = connectionGeneration;
    const revision = stateRevision;
    const isCurrent = () =>
      generation === connectionGeneration && owner === client && revision === stateRevision;
    actionCheckRunning = true;
    state.actionStatus = 'unknown';
    try {
      const response = await owner.getActions();
      if (!isCurrent()) return;
      const action =
        response.actions.find(
          (candidate) => candidate.group === ACTION_GROUP && candidate.name === ACTION_NAME,
        ) ?? null;
      state.action = action
        ? { id: action.id, name: action.name, group: action.group, enabled: action.enabled }
        : null;
      state.presetActions = response.actions
        .filter(
          (candidate) =>
            candidate.enabled &&
            candidate.group === ACTION_GROUP &&
            candidate.name.startsWith('PRESET |'),
        )
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          group: candidate.group,
          enabled: candidate.enabled,
          label: candidate.name.slice('PRESET |'.length).trim() || candidate.name,
        }));
      state.actionStatus = !action ? 'missing' : !action.enabled ? 'disabled' : 'ready';
      if (state.actionStatus === 'ready') await refreshState();
    } catch (error) {
      if (!isCurrent()) return;
      state.connection = 'disconnected';
      state.connectionError = error instanceof Error ? error.message : t('actionsFailed');
      state.authNeeded = /auth|password|credential/i.test(state.connectionError);
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
    if (disposed || !client?.ready || !state.action) throw new Error(t('actionUnavailable'));
    const owner = client;
    const generation = connectionGeneration;
    const requestId = uuid();
    const reply = new Promise<ActionResponse>((resolve, reject) => {
      const timer = later(() => {
        requestResolvers.delete(requestId);
        reject(new Error(t('actionTimeout')));
      }, REQUEST_TIMEOUT);
      requestResolvers.set(requestId, { generation, command, resolve, reject, timer });
    });
    // Retirement can reject the reply before the transport acknowledgement.
    void reply.catch(() => undefined);
    try {
      const [, response] = await Promise.all([
        owner.doAction(
          { id: state.action.id },
          { command, requestId, payloadJson: JSON.stringify(payload) },
        ),
        reply,
      ]);
      return response;
    } catch (error) {
      const pending = requestResolvers.get(requestId);
      if (pending) {
        cancelTimer(pending.timer);
        requestResolvers.delete(requestId);
      }
      throw error;
    }
  }

  async function saveTemplates(): Promise<void> {
    const current = taskGuard();
    const draft = { ...state.templateDraft };
    if (!isTemplateValid(draft.twitchTemplate)) return;
    state.templatesSaving = true;
    try {
      const response = await callAction('saveTemplates', {
        twitchTemplate: draft.twitchTemplate,
        subtitle: settings.lastSubtitle,
      });
      if (!current()) return;
      if (!response.ok || !response.data)
        throw new Error(response.error?.message ?? t('templateStateSaveFailed'));
      const templates = normalizeTemplates(response.data.templates);
      const editedWhileSaving = state.templateDraft.twitchTemplate !== draft.twitchTemplate;
      syncTemplates({ ...templates, configured: true }, editedWhileSaving);
      notify(t('templateSaved'), [t('templateSavedDescription')], 'success');
    } catch (error) {
      if (!current()) return;
      notify(t('templateSaveFailed'), [error instanceof Error ? error.message : t('unknownError')]);
    } finally {
      if (current()) {
        state.templatesSaving = false;
      }
    }
  }

  async function persistSubtitle(subtitle: string): Promise<boolean> {
    const current = taskGuard();
    const value = subtitle.trim();
    if (value === settings.lastSubtitle) {
      state.subtitleDirty = false;
      return true;
    }
    if (disposed || !client?.ready || !state.action) return false;
    try {
      const response = await callAction('saveTemplates', {
        twitchTemplate: settings.twitchTemplate,
        subtitle: value,
      });
      if (!current()) return false;
      if (!response.ok) throw new Error(response.error?.message ?? t('subtitleStateSaveFailed'));
      settings.lastSubtitle = value;
      saveSettings();
      // Do not overwrite newer editor input after a slow acknowledgement.
      if (state.templateDraft.subtitle.trim() === value) state.subtitleDirty = false;
      return true;
    } catch (error) {
      if (!current()) return false;
      notify(t('subtitleSaveFailed'), [error instanceof Error ? error.message : t('unknownError')]);
      return false;
    }
  }

  async function runPreset(id: string, name: string): Promise<void> {
    const current = taskGuard();
    if (!client?.ready) return;
    state.runningPresetId = id;
    try {
      await client.doAction({ id }, {});
      if (!current()) return;
      later(() => {
        if (current()) void refreshState(false);
      }, 700);
      notify(t('presetStarted'), [name], 'info');
    } catch (error) {
      if (!current()) return;
      notify(t('presetStartFailed'), [error instanceof Error ? error.message : t('unknownError')]);
    } finally {
      if (current()) {
        state.runningPresetId = null;
      }
    }
  }

  async function refreshState(showError = true): Promise<void> {
    if (disposed || state.actionStatus !== 'ready') return;
    const generation = connectionGeneration;
    const revision = ++stateRevision;
    const isCurrent = () => generation === connectionGeneration && revision === stateRevision;
    try {
      const response = await callAction('getState');
      if (!isCurrent()) return;
      if (!response.ok || !response.data)
        throw new Error(response.error?.message ?? t('actionStateFailed'));
      const stream = normalizeStream(response.data);
      if (stream.apiVersion !== API_VERSION || response.apiVersion !== API_VERSION) {
        state.actionStatus = 'outdated';
        state.stream = null;
        return;
      }
      syncTemplates(stream.templates);
      state.stream = stream;
      if (!state.allDirty && !state.allSaving) initializeEditor();
      state.lastUpdated = new Date();
    } catch (error) {
      if (!isCurrent()) return;
      if (showError)
        notify(t('refreshFailed'), [error instanceof Error ? error.message : t('unknownError')]);
    }
  }

  function categoryFromState(_platform: Platform): TwitchCategory | null {
    const item = state.stream?.twitch;
    if (!item?.categoryId && !item?.categoryName) return null;
    return {
      id: item.categoryId ?? '',
      name: item.categoryName ?? '',
      imageUrl: item.categoryImageUrl ?? '',
    };
  }

  function initializeEditor(preservePlatforms: Platform[] = []): void {
    if (!state.stream) return;
    const previous = state.allForm;
    resetCategorySearch();
    state.allForm = {
      subtitle: state.templateDraft.subtitle,
      twitchTitle: state.stream.twitch.title ?? '',
      twitchTitleMode: previous?.twitchTitleMode ?? 'subtitle',
      twitchCategory: categoryFromState('twitch'),
      twitchTags: [...asStringArray(state.stream.twitch.tags)],
      twitchTagDraft: previous?.twitchTagDraft ?? '',
      twitchCategoryQuery: '',
    };
    if (previous) {
      if (!settings.twitchEnabled || preservePlatforms.includes('twitch')) {
        state.allForm.twitchTitle = previous.twitchTitle;
        state.allForm.twitchCategory = previous.twitchCategory;
        state.allForm.twitchTags = previous.twitchTags;
        state.allForm.twitchTagDraft = previous.twitchTagDraft;
        state.allForm.twitchCategoryQuery = previous.twitchCategoryQuery;
      }
    }
  }

  function tagsEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }

  function validateTwitch(title: string, tags: string[]): string[] {
    const errors: string[] = [];
    if (!title.trim()) errors.push(t('twitchTitleRequired'));
    if (title.length > 140) errors.push(t('twitchTitleTooLong'));
    if (tags.length > 10) errors.push(t('twitchTagsTooMany'));
    if (tags.some((tag) => !tag.trim() || tag.length > 25 || /\s/.test(tag)))
      errors.push(t('twitchTagsInvalid'));
    if (new Set(tags.map((tag) => tag.toLocaleLowerCase('ru-RU'))).size !== tags.length)
      errors.push(t('twitchTagsDuplicate'));
    return errors;
  }

  function validateAll(form: AllForm): string[] {
    const messages: string[] = [];
    if (platformAvailable('twitch') && form.twitchCategoryQuery.trim())
      messages.push(t('categorySelectionRequired', { platform: 'Twitch' }));
    if (platformAvailable('twitch'))
      messages.push(...validateTwitch(inlineTitle('twitch', form), form.twitchTags));
    return messages;
  }

  function flashCard(platform: Platform, ok: boolean): void {
    const current = taskGuard();
    if (ok) {
      state.cardErrors[platform] = false;
      state.cardEffects[platform] = 'success';
      later(() => {
        if (current()) state.cardEffects[platform] = null;
      }, 3_000);
    } else {
      state.cardErrors[platform] = true;
      state.cardEffects[platform] = 'flash-error';
      later(() => {
        if (current()) state.cardEffects[platform] = null;
      }, 5_000);
    }
  }

  function fieldsToLines(fields: unknown, _platform: Platform): string[] {
    const source = isRecord(fields) ? fields : {};
    const labels: Record<string, string> = {
      title: t('title'),
      category: t('category'),
      tags: t('tags'),
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
    if (!Object.keys(payload).length) return true;
    state.loadingPlatforms.add(platform);
    try {
      const response = await callAction('updateTwitch', payload);
      if (!current()) return false;
      const ok = response.ok;
      flashCard(platform, ok);
      if (!ok)
        notify(
          t('updateFailed', { platform: 'Twitch' }),
          fieldsToLines(response.data?.fields, platform),
        );
      await refreshState(false);
      return ok;
    } catch (error) {
      if (!current()) return false;
      flashCard(platform, false);
      notify(t('updateFailed', { platform: 'Twitch' }), [
        error instanceof Error ? error.message : t('unknownError'),
      ]);
      await refreshState(false);
      return false;
    } finally {
      if (current()) {
        state.loadingPlatforms.delete(platform);
      }
    }
  }

  async function saveAll(): Promise<void> {
    const current = taskGuard();
    const form = state.allForm;
    const stream = state.stream;
    if (!form || !stream || editorBusy() || !platformAvailable('twitch')) return;
    const errors = validateAll(form);
    if (errors.length) {
      return;
    }
    state.allSaving = true;
    try {
      if (form.subtitle.trim() !== settings.lastSubtitle && !(await persistSubtitle(form.subtitle)))
        return;
      if (!current()) return;
      const twitchPayload: TwitchUpdatePayload = {};
      const twitchTitle = inlineTitle('twitch', form);
      if (platformAvailable('twitch')) {
        if (twitchTitle !== stream.twitch.title) twitchPayload.title = twitchTitle;
        if (form.twitchCategory && form.twitchCategory.id !== stream.twitch.categoryId)
          twitchPayload.categoryId = form.twitchCategory.id;
        if (!tagsEqual(form.twitchTags, asStringArray(stream.twitch.tags)))
          twitchPayload.tags = form.twitchTags;
      }
      const jobs: Promise<boolean>[] = [];
      if (Object.keys(twitchPayload).length) jobs.push(updatePlatform('twitch', twitchPayload));
      if (!jobs.length) notify(t('unchanged'), [t('unchangedDescription')], 'info');
      const results = await Promise.all(jobs);
      if (!current()) return;
      if (results.every(Boolean)) {
        const platforms: Platform[] = ['twitch'];
        const preserved = platforms.filter((platform) => !platformAvailable(platform));
        const pending =
          preserved.some((platform) => {
            const current = stream[platform];
            const category = form.twitchCategory;
            const tags = form.twitchTags;
            const query = form.twitchCategoryQuery;
            return (
              inlineTitle(platform, form) !== current.title ||
              (category !== null && category.id !== current.categoryId) ||
              !tagsEqual(tags, asStringArray(current.tags)) ||
              query.trim().length > 0
            );
          }) || Boolean(form.twitchTagDraft.trim());
        initializeEditor(preserved);
        state.allDirty = pending;
        state.allSaveResult = pending ? 'partial' : 'saved';
      }
    } finally {
      if (current()) {
        state.allSaving = false;
      }
    }
  }

  function addTag(scope: string): void {
    const holder = getTagHolder(scope);
    if (!holder) return;
    state.allDirty = true;
    state.allSaveResult = null;
    const value = holder.draft.trim();
    if (!value) return;
    if (!holder.tags.some((tag) => tag.localeCompare(value, 'ru', { sensitivity: 'accent' }) === 0))
      holder.tags.push(value);
    holder.setDraft('');
  }

  function getTagHolder(
    scope: string,
  ): { tags: string[]; draft: string; setDraft: (value: string) => void } | null {
    if (scope === 'all-twitch' && state.allForm)
      return {
        tags: state.allForm.twitchTags,
        draft: state.allForm.twitchTagDraft,
        setDraft: (value) => {
          if (state.allForm) state.allForm.twitchTagDraft = value;
        },
      };
    return null;
  }

  function chooseCategory(kind: Platform, scope: string, id: string): void {
    const category = state.twitchResults.find((item) => item.id === id);
    if (!category) return;
    if (scope === 'all-twitch' && state.allForm && kind === 'twitch') {
      state.allForm.twitchCategory = category;
      state.allForm.twitchCategoryQuery = '';
    }
    state.allDirty = true;
    state.allSaveResult = null;
    if (kind === 'twitch') resetCategorySearch();
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
      if (job.generation !== searchGeneration) return;
      if (response.ok !== true || !isRecord(response.data) || !Array.isArray(response.data.results))
        throw new Error(response.error?.message ?? t('categorySearchFailed'));
      const incoming = response.data.results
        .filter(isRecord)
        .map((item) => ({
          id: textValue(item.id),
          name: textValue(item.name),
          imageUrl: textValue(item.imageUrl),
        }))
        .filter((item) => item.id && item.name);
      state.twitchResults = rankCategories(
        job.cursor ? [...state.twitchResults, ...incoming] : incoming,
        job.query,
      );
      search.searchCursor =
        typeof response.data.cursor === 'string' && response.data.cursor
          ? response.data.cursor
          : null;
      search.searchHasMore = response.data.hasMore === true && search.searchCursor !== null;
      search.searchPartial =
        (Boolean(job.cursor) && search.searchPartial) || response.data.partial === true;
      search.searchWarnings = Array.from(
        new Set([
          ...(job.cursor ? search.searchWarnings : []),
          ...asStringArray(response.data.warnings),
        ]),
      );
      search.searchError = null;
      failedSearch = null;
      if (job.cursor) search.visibleCategories += 20;
    } catch (error) {
      if (job.generation === searchGeneration) {
        search.searchError = error instanceof Error ? error.message : t('categorySearchFailed');
        failedSearch = job;
      }
    } finally {
      searchFlight = null;
      if (job.generation === searchGeneration) {
        search.twitchSearching = false;
      }
      const next = queuedSearch;
      queuedSearch = null;
      if (!disposed && next && next.generation === searchGeneration) void runSearch(next);
    }
  }

  function scheduleTwitchSearch(query: string): void {
    resetCategorySearch();
    const requested = query.trim();
    state.twitchSearchFor = requested;
    search.twitchSearching = requested.length >= 2;
    if (search.twitchSearching) {
      const job: SearchJob = { query: requested, generation: searchGeneration };
      searchTimer = later(() => {
        searchTimer = null;
        void runSearch(job);
      }, 250);
    }
  }

  const search = reactive<{
    twitchSearching: boolean;
    searchError: string | null;
    searchCursor: string | null;
    searchHasMore: boolean;
    searchWarnings: string[];
    searchPartial: boolean;
    visibleCategories: number;
  }>({
    twitchSearching: false,
    searchError: null,
    searchCursor: null,
    searchHasMore: false,
    searchWarnings: [],
    searchPartial: false,
    visibleCategories: 20,
  });
  let disposed = false;
  const timers = new Set<number>();
  function cancelTimer(id: number): void {
    window.clearTimeout(id);
    timers.delete(id);
  }
  function later(callback: () => void, delay: number): number {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) callback();
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
    state.templatesSaving = false;
    state.runningPresetId = null;
    state.loadingPlatforms.clear();
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
      if (settings.twitchEnabled) state.allForm.twitchTitleMode = 'subtitle';
      markDirty();
    }
  }
  function setTitle(value: string): void {
    if (state.allForm) {
      state.allForm.twitchTitle = value;
      markDirty();
    }
  }
  function setTitleMode(mode: 'subtitle' | 'full'): void {
    if (state.allForm && !editorBusy()) {
      state.allForm.twitchTitleMode = mode;
      markDirty();
    }
  }
  function setEnabled(value: boolean): void {
    if (!editorBusy()) {
      settings.twitchEnabled = value;
      state.settingsDraft.twitchEnabled = value;
      saveSettings();
    }
  }
  function setTemplate(value: string): void {
    state.templateDraft.twitchTemplate = value;
    updateTemplatesDirty();
  }
  function resetTemplates(): void {
    setTemplate(DEFAULT_TWITCH_TEMPLATE);
  }
  function setCategoryQuery(value: string, composing = false): void {
    if (state.allForm) state.allForm.twitchCategoryQuery = value;
    markDirty();
    if (!composing) scheduleTwitchSearch(value);
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
      void runSearch(failedSearch);
    }
  }
  function moreCategories(): void {
    if (search.twitchSearching) return;
    if (
      rankCategories(state.twitchResults, state.twitchSearchFor).length > search.visibleCategories
    )
      search.visibleCategories += 20;
    else if (search.searchHasMore && search.searchCursor) {
      search.twitchSearching = true;
      search.searchError = null;
      void runSearch({
        query: state.twitchSearchFor,
        cursor: search.searchCursor,
        generation: searchGeneration,
      });
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
      host: draft.host.trim(),
      password: draft.password,
      rememberPassword: draft.rememberPassword,
      endpoint: draft.endpoint.trim() || '/',
      port: Math.max(1, Math.min(65535, Number(draft.port) || 8080)),
    };
    const connectionChanged =
      next.host !== settings.host ||
      next.port !== settings.port ||
      next.endpoint !== settings.endpoint ||
      next.password !== settings.password;
    Object.assign(settings, next);
    saveSettings();
    closeSettings();
    if (connectionChanged || state.connection !== 'connected') void connect();
  }
  function onVisibility(): void {
    if (document.visibilityState === 'visible') void refreshState(false);
  }
  onMounted(() => {
    if (demoMode) {
      enableDemoMode();
      initializeEditor();
      return;
    }
    document.addEventListener('visibilitychange', onVisibility);
    pollingId = window.setInterval(onVisibility, 30_000);
    void connect();
  });
  onScopeDispose(() => {
    disposed = true;
    ++connectionGeneration;
    ++stateRevision;
    resetCategorySearch();
    rejectPendingRequests();
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    if (pollingId !== null) window.clearInterval(pollingId);
    document.removeEventListener('visibilitychange', onVisibility);
    const previous = client;
    client = null;
    if (previous) void Promise.resolve(previous.disconnect()).catch(() => undefined);
  });
  const busy = computed(editorBusy);
  const available = computed(() => platformAvailable('twitch'));
  const errors = computed(() => (state.allForm ? validateAll(state.allForm) : []));
  const title = computed(() => (state.allForm ? inlineTitle('twitch', state.allForm) : ''));
  return {
    state,
    settings,
    search,
    busy,
    available,
    errors,
    title,
    version: APP_VERSION,
    connectionText,
    cardStatus,
    closeNotice,
    refreshState,
    verifyAction,
    connect,
    saveAll,
    saveTemplates,
    runPreset,
    setSubtitle,
    setTitle,
    setTitleMode,
    setEnabled,
    setTemplate,
    resetTemplates,
    setCategoryQuery,
    setTagDraft,
    removeTag,
    retrySearch,
    moreCategories,
    resetCategorySearch,
    addTag: () => addTag('all-twitch'),
    chooseCategory: (id: string) => chooseCategory('twitch', 'all-twitch', id),
    openSettings,
    closeSettings,
    saveConnection,
  };
}
