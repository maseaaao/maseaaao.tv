import { parseRecord, textValue } from '../assertions';

type CodeEventHandler = (payload: unknown) => void;

interface ActionShape {
  enabled: boolean;
  group: string;
  id: string;
  name: string;
}

const apiAction: ActionShape = {
  enabled: true,
  group: 'STREAM INFO',
  id: 'api-action',
  name: 'STREAM INFO | API',
};
const presetAction: ActionShape = {
  enabled: true,
  group: 'STREAM INFO',
  id: 'preset-pubg',
  name: 'PRESET | PUBG',
};

function defaultState() {
  return {
    apiVersion: 4,
    templates: { configured: true, subtitle: 'Старт', twitchTemplate: '🔴 %subtitle%| !tg' },
    twitch: {
      accountName: 'Twitch account',
      categoryId: '493057',
      categoryImageUrl: '',
      categoryName: 'PUBG: BATTLEGROUNDS',
      connected: true,
      live: true,
      login: 'tester',
      tags: ['PUBG'],
      title: 'Twitch title',
    },
  };
}

interface MockStreamerbot {
  actionCalls: Array<{ id: string; args: Record<string, unknown> }>;
  actionReplies: Record<string, Record<string, unknown>>;
  actions: ActionShape[];
  connectCalls: number;
  deferSearch: boolean;
  disconnectHook: (() => void) | null;
  failConnect: boolean;
  instances: StreamerbotClient[];
  pendingSearches: Array<{
    payload: Record<string, unknown>;
    reply: (envelope: Record<string, unknown>) => void;
  }>;
  reset: () => void;
  searchDelay: number;
  searchReply: Record<string, unknown> | null;
  state: ReturnType<typeof defaultState>;
}

const mockKey = '__changeInfoStreamerbotMock__';
declare global {
  var __changeInfoStreamerbotMock__: MockStreamerbot | undefined;
}
const globalMocks = globalThis;

globalMocks[mockKey] ??= {
  actionCalls: [],
  actionReplies: {},
  actions: [apiAction, presetAction],
  connectCalls: 0,
  deferSearch: false,
  disconnectHook: null,
  failConnect: false,
  instances: [],
  pendingSearches: [],
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
  searchDelay: 0,
  searchReply: null,
  state: defaultState(),
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
      if (mockStreamerbot.failConnect) {
        this.options.onError?.(new Error('WebSocket password required'));
      } else {
        this.options.onConnect?.();
      }
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
    mockStreamerbot.actionCalls.push({ args, id: action.id });
    if (action.id !== apiAction.id) {
      return Promise.resolve();
    }
    const command = textValue(args.command);
    const payload = typeof args.payloadJson === 'string' ? parseRecord(args.payloadJson) : {};
    let data: Record<string, unknown> = {};
    if (command === 'getState') {
      data = mockStreamerbot.state;
    }
    if (command === 'searchTwitchCategories') {
      data = { results: [{ id: '493057', imageUrl: '', name: 'PUBG: BATTLEGROUNDS' }] };
    }
    if (command === 'updateTwitch') {
      data = { fields: { category: true, tags: true, title: true } };
    }
    if (command === 'saveTemplates') {
      mockStreamerbot.state.templates = {
        configured: true,
        subtitle: textValue(payload.subtitle),
        twitchTemplate: textValue(payload.twitchTemplate),
      };
      data = { templates: mockStreamerbot.state.templates };
    }
    const response = {
      apiVersion: 4,
      command,
      data,
      error: null,
      ok: true,
      requestId: textValue(args.requestId),
    };
    if (command === 'searchTwitchCategories' && mockStreamerbot.deferSearch) {
      mockStreamerbot.pendingSearches.push({
        payload,
        reply: (envelope) =>
          this.handlers.get('Custom.CodeEvent')?.({
            data: { args: { ...response, ...envelope }, eventName: 'stream_info_api_response' },
          }),
      });
      return Promise.resolve();
    }
    if (command === 'searchTwitchCategories' && mockStreamerbot.searchReply) {
      Object.assign(response, mockStreamerbot.searchReply);
    }
    Object.assign(response, mockStreamerbot.actionReplies[command]);
    const emit = () =>
      this.handlers.get('Custom.CodeEvent')?.({
        data: { args: response, eventName: 'stream_info_api_response' },
      });
    if (command === 'searchTwitchCategories' && mockStreamerbot.searchDelay) {
      window.setTimeout(emit, mockStreamerbot.searchDelay);
    } else {
      queueMicrotask(emit);
    }
    return Promise.resolve();
  }
}
