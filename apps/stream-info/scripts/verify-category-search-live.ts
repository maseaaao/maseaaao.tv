import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StreamerbotClient } from '@streamerbot/client';
import type { ActionResponse, ActionSummary, TwitchCategory } from '../src/types';

interface SearchData {
  cursor?: string | null;
  hasMore?: boolean;
  partial?: boolean;
  results: TwitchCategory[];
}
type SearchResponse = Omit<ActionResponse, 'data'> & { data: SearchData | null };
type PendingResponse = Pick<SearchResponse, 'ok' | 'error' | 'data'>;

// Read-only search acceptance checks: never calls update/apply/preset commands.
let resolveConnection!: () => void;
let rejectConnection!: (reason: unknown) => void;
const connected = new Promise<void>((resolve, reject) => {
  resolveConnection = resolve;
  rejectConnection = reject;
});
const client = new StreamerbotClient({
  autoReconnect: false,
  endpoint: '/',
  host: '127.0.0.1',
  immediate: false,
  logLevel: 'none',
  onConnect: resolveConnection,
  onError: rejectConnection,
  port: 8080,
  retries: 0,
});
const pending = new Map<string, (response: PendingResponse) => void>();
await client.on('Custom.CodeEvent', (payload) => {
  const event = payload?.data as { eventName?: string; args?: SearchResponse } | undefined;
  if (event?.eventName !== 'stream_info_api_response') {
    return;
  }
  if (event.args?.requestId) {
    pending.get(event.args.requestId)?.(event.args);
  }
});
let action: ActionSummary | undefined;
async function search(query: string, cursor?: string) {
  assert.ok(action, 'Search Action missing or disabled');
  const requestId = `search-check-${randomUUID()}`;
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reply = new Promise<PendingResponse>((resolve, reject) => {
    timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Search timed out: ${query}`));
    }, 14_000);
    pending.set(requestId, (response) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(response);
    });
  });
  try {
    await client.doAction(
      { id: action.id },
      {
        command: 'searchTwitchCategories',
        payloadJson: JSON.stringify({ query, ...(cursor ? { cursor } : {}) }),
        requestId,
      },
    );
    const response = await reply;
    assert.equal(response.ok, true, `${query}: ${response.error?.message ?? 'unsuccessful reply'}`);
    assert.ok(response.data && Array.isArray(response.data.results), `${query}: malformed results`);
    return { ...response.data, elapsedMs: Math.round(performance.now() - start) };
  } finally {
    clearTimeout(timer);
    pending.delete(requestId);
  }
}
const normalized = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
try {
  const connectionTimer = setTimeout(
    () => rejectConnection(new Error('Connection timeout')),
    10_000,
  );
  try {
    await Promise.all([client.connect(), connected]);
  } finally {
    clearTimeout(connectionTimer);
  }
  action = (await client.getActions()).actions.find(
    (item) => item.name === 'STREAM INFO | API' && item.enabled,
  );
  assert.ok(action, 'Search Action missing or disabled');
  const report: {
    count: number;
    elapsedMs: number;
    first?: { id: string; name: string }[];
    hasMore?: boolean;
    page?: number;
    partial?: boolean;
    query: string;
  }[] = [];
  for (const query of [
    'Aniimo',
    'ani',
    'Counter Strike',
    'Final Fantasy',
    'Pokemon',
    'CS2',
    '2048',
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: Probe in order; preserve retry timing and stop after the first successful result.
    const result = await search(query);
    const [first] = result.results;
    assert.ok(first, `${query}: no candidates`);
    const ids = result.results.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `${query}: duplicate IDs`);
    if (query === 'Aniimo') {
      assert.equal(first.name.toLowerCase(), 'aniimo');
    }
    if (query === 'ani' || query === 'Final Fantasy') {
      assert.ok(result.results.length > 1, `${query}: exact lookup suppressed autocomplete`);
    }
    if (query === 'Counter Strike') {
      assert.equal(
        normalized(first.name),
        'counter strike',
        'Punctuation-equivalent title must precede long substring',
      );
    }
    if (query === 'Pokemon') {
      assert.ok(
        normalized(first.name).startsWith('pokemon'),
        'Diacritic-equivalent titles must precede unrelated lookup aliases',
      );
    }
    if (query === 'CS2') {
      assert.ok(
        result.results.some((item) => normalized(item.name) === 'counter strike'),
        'Common abbreviation must include its configured canonical title',
      );
    }
    report.push({
      count: result.results.length,
      elapsedMs: result.elapsedMs,
      first: result.results.slice(0, 3).map((item) => ({ id: item.id, name: item.name })),
      hasMore: result.hasMore === true,
      partial: result.partial === true,
      query,
    });
    if (query === 'Pokemon' && result.hasMore && result.cursor) {
      const next = await search(query, result.cursor);
      assert.ok(next.results.length, 'Pagination returned no next candidates');
      assert.notEqual(next.cursor, result.cursor, 'Pagination did not advance');
      report.push({
        count: next.results.length,
        elapsedMs: next.elapsedMs,
        hasMore: next.hasMore === true,
        page: 2,
        query,
      });
    }
  }
  const repeated = await search('Aniimo');
  assert.equal(repeated.results[0]?.name.toLowerCase(), 'aniimo');
  console.log(
    JSON.stringify(
      { actionId: action.id, ok: true, queries: report, repeatMs: repeated.elapsedMs },
      null,
      2,
    ),
  );
} finally {
  for (const resolve of pending.values()) {
    resolve({ data: null, error: { message: 'Disconnected' }, ok: false });
  }
  pending.clear();
  await client.disconnect().catch(() => {
    /* Разрыв отладочного соединения — сбой закрытия не влияет на результат проверки. */
  });
}
