import { randomUUID } from 'node:crypto';
import { StreamerbotClient } from '@streamerbot/client';
import type { ActionResponse, StreamState } from '../src/types';

type StateResponse = Omit<ActionResponse, 'data'> & { data: Partial<StreamState> | null };

const actionName = 'STREAM INFO | API';
const responseEvent = 'stream_info_api_response';

let connectedResolve!: () => void;
let connectedReject!: (reason: unknown) => void;
const connected = new Promise<void>((resolve, reject) => {
  connectedResolve = resolve;
  connectedReject = reject;
});

const client = new StreamerbotClient({
  autoReconnect: false,
  endpoint: '/',
  host: '127.0.0.1',
  immediate: false,
  logLevel: 'none',
  onConnect: connectedResolve,
  onError: connectedReject,
  port: 8080,
  retries: 0,
});

const pending = new Map<string, (response: StateResponse) => void>();
await client.on('Custom.CodeEvent', (payload) => {
  const root = payload?.data as { eventName?: string; args?: StateResponse } | undefined;
  if (root?.eventName !== responseEvent || !root.args?.requestId) {
    return;
  }
  const resolve = pending.get(root.args.requestId);
  if (!resolve) {
    return;
  }
  pending.delete(root.args.requestId);
  resolve(root.args);
});

function waitForResponse(requestId: string, timeoutMs = 15_000): Promise<StateResponse> {
  return new Promise<StateResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Timed out waiting for ${requestId}`));
    }, timeoutMs);
    pending.set(requestId, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

try {
  await client.connect();
  await Promise.race([
    connected,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 10_000),
    ),
  ]);

  const actions = await client.getActions();
  const action = actions.actions.find((candidate) => candidate.name === actionName);
  if (!action?.enabled) {
    throw new Error(`${actionName} is missing or disabled`);
  }

  const requestId = `codex-live-${randomUUID()}`;
  const reply = waitForResponse(requestId);
  await client.doAction({ id: action.id }, { command: 'getState', payloadJson: '{}', requestId });
  const response = await reply;

  if (response.ok !== true || response.apiVersion !== 4 || !response.data) {
    throw new Error(`Unexpected Action response: ${JSON.stringify(response)}`);
  }

  console.log(
    JSON.stringify(
      {
        actionEnabled: action.enabled,
        actionId: action.id,
        apiVersion: response.apiVersion,
        responseOk: response.ok,
        templatesPresent: typeof response.data.templates?.twitchTemplate === 'string',
        twitchConnected: response.data.twitch?.connected === true,
        twitchLive: response.data.twitch?.live === true,
        websocketReady: client.ready,
      },
      null,
      2,
    ),
  );
} finally {
  await client.disconnect().catch(() => {
    /* Разрыв отладочного соединения — сбой закрытия не влияет на результат проверки. */
  });
}
