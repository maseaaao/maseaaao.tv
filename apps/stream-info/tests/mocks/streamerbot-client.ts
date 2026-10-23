import { parseRecord, textValue } from '../assertions';

type CodeEventHandler = (payload: unknown) => void;

interface ActionShape {
  id: string;
  name: string;
  group: string;
  enabled: boolean;
}

const apiAction: ActionShape = {
  id: 'api-action',
  name: 'STREAM INFO | API',
  group: 'STREAM INFO',
  enabled: true,
};
const presetAction: ActionShape = {
  id: 'preset-pubg',
  name: 'PRESET | PUBG',
  group: 'STREAM INFO',
  enabled: true,
};

function defaultState() {
  return {
    apiVersion: 4,
    twitch: {
      connected: true,
      live: true,
      accountName: 'Twitch account',
      login: 'tester',
      title: 'Twitch title',
      categoryId: '493057',
      categoryName: 'PUBG: BATTLEGROUNDS',
      categoryImageUrl: '',
      tags: ['PUBG'],
    },
    templates: { twitchTemplate: '🔴 %subtitle%| !tg', subtitle: 'Старт', configured: true },
  };
}

interface MockStreamerbot {
  actions: ActionShape[];
  state: ReturnType<typeof defaultState>;
  actionCalls: Array<{ id: string; args: Record<string, unknown> }>;
  instances: StreamerbotClient[];
  connectCalls: number;
  failConnect: boolean;
  searchDelay: number;
  searchReply: Record<string, unknown> | null;
  actionReplies: Record<string, Record<string, unknown>>;
  deferSearch: boolean;
  pendingSearches: Array<{
    payload: Record<string, unknown>;
    reply: (envelope: Record<string, unknown>) => void;
  }>;
  disconnectHook: (() => void) | null;
  reset(): void;
}

const mockKey = '__changeInfoStreamerbotMock__';
declare global {
  var __changeInfoStreamerbotMock__: MockStreamerbot | undefined;
}
const globalMocks = globalThis;

globalMocks[mockKey] ??= {
  actions: [apiAction, presetAction],
  state: defaultState(),
  actionCalls: [],
  instances: [],
  connectCalls: 0,
  failConnect: false,
  searchDelay: 0,
  searchReply: null,
  actionReplies: {},
  deferSearch: false,
  pendingSearches: [],
  disconnectHook: null,
  reset(): void {
    this.actions = [apiAction, presetAction];
    this.state = defaultState();
    this.actionCalls = [];
    this.instances = [];
    this.connectCalls = 0;
    this.failConnect = false;
    this.searchDelay = 0;
    this.searchReply = null;
    this.actionReplies = {};
    this.deferSearch = false;
    this.pendingSearches = [];
    this.disconnectHook = null;
  },
};

export const mockStreamerbot: MockStreamerbot = globalMocks[mockKey];

export class StreamerbotClient {
  ready = true;
  private readonly handlers = new Map<string, CodeEventHandler>();
  readonly options: {
    onConnect?: () => void;
    onError?: (error: unknown) => void;
    onDisconnect?: () => void;
  };

  constructor(options: {
    onConnect?: () => void;
    onError?: (error: unknown) => void;
    onDisconnect?: () => void;
  }) {
    this.options = options;
    mockStreamerbot.instances.push(this);
    mockStreamerbot.disconnectHook = () => {
      this.ready = false;
      options.onDisconnect?.();
    };
  }

  on(event: string, handler: CodeEventHandler): Promise<void> {
    this.handlers.set(event, handler);
    return Promise.resolve();
  }

  connect(): Promise<void> {
    mockStreamerbot.connectCalls += 1;
    queueMicrotask(() => {
      if (mockStreamerbot.failConnect)
        this.options.onError?.(new Error('WebSocket password required'));
      else this.options.onConnect?.();
    });
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  getActions(): Promise<{ actions: ActionShape[] }> {
    return Promise.resolve({ actions: mockStreamerbot.actions });
  }

  doAction(action: { id: string }, args: Record<string, unknown> = {}): Promise<void> {
    mockStreamerbot.actionCalls.push({ id: action.id, args });
    if (action.id !== apiAction.id) return Promise.resolve();
    const command = textValue(args.command);
    const payload = typeof args.payloadJson === 'string' ? parseRecord(args.payloadJson) : {};
    let data: Record<string, unknown> = {};
    if (command === 'getState') data = mockStreamerbot.state;
    if (command === 'searchTwitchCategories')
      data = { results: [{ id: '493057', name: 'PUBG: BATTLEGROUNDS', imageUrl: '' }] };
    if (command === 'updateTwitch') data = { fields: { title: true, category: true, tags: true } };
    if (command === 'saveTemplates') {
      mockStreamerbot.state.templates = {
        twitchTemplate: textValue(payload.twitchTemplate),
        subtitle: textValue(payload.subtitle),
        configured: true,
      };
      data = { templates: mockStreamerbot.state.templates };
    }
    const response = {
      apiVersion: 4,
      requestId: textValue(args.requestId),
      command,
      ok: true,
      data,
      error: null,
    };
    if (command === 'searchTwitchCategories' && mockStreamerbot.deferSearch) {
      mockStreamerbot.pendingSearches.push({
        payload,
        reply: (envelope) =>
          this.handlers.get('Custom.CodeEvent')?.({
            data: { eventName: 'stream_info_api_response', args: { ...response, ...envelope } },
          }),
      });
      return Promise.resolve();
    }
    if (command === 'searchTwitchCategories' && mockStreamerbot.searchReply)
      Object.assign(response, mockStreamerbot.searchReply);
    Object.assign(response, mockStreamerbot.actionReplies[command]);
    const emit = () =>
      this.handlers.get('Custom.CodeEvent')?.({
        data: { eventName: 'stream_info_api_response', args: response },
      });
    if (command === 'searchTwitchCategories' && mockStreamerbot.searchDelay)
      window.setTimeout(emit, mockStreamerbot.searchDelay);
    else queueMicrotask(emit);
    return Promise.resolve();
  }
}
