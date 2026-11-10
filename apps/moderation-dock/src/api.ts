export interface ModerationItemView {
  amount: string;
  audioUrl: string;
  convertedAmount: string;
  createdUtc: string;
  currency: string;
  hasAudio: boolean;
  id: string;
  kind: string;
  message: string;
  platform: string;
  provider: string;
  providerError: string;
  reason: string;
  status: string;
  updatedUtc: string;
  username: string;
}

interface ModerationConfigView {
  deepSeekModel: string;
  displaySeconds: number;
  goModel: string;
  goReasoning: string;
  hasDeepSeekKey: boolean;
  hasGoKey: boolean;
  outputsReady: boolean;
  paused: boolean;
  rules: string;
  timeoutSeconds: number;
}

export interface ModerationState {
  config: ModerationConfigView;
  counts: Record<string, number>;
  items: ModerationItemView[];
  lastError: string;
  ok: boolean;
  running: boolean;
  session: string;
}

export interface ConfigPayload {
  clearDeepSeekKey?: boolean;
  clearGoKey?: boolean;
  deepSeekKey?: string;
  deepSeekModel: string;
  displaySeconds: number;
  goKey?: string;
  goModel: string;
  goReasoning: string;
  outputsReady: boolean;
  paused: boolean;
  rules: string;
  timeoutSeconds: number;
}

export interface ApiResult {
  decision?: string;
  error?: string;
  ok: boolean;
  reason?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const text = await response.text();
  let value: unknown = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch (cause) {
    throw new Error(`HTTP ${response.status}`, { cause });
  }
  if (!response.ok && (value as ApiResult | null)?.ok !== false) {
    throw new Error(`HTTP ${response.status}`);
  }
  return value as T;
}

export function fetchState(): Promise<ModerationState> {
  return request<ModerationState>('/api/state');
}

export function reviewItem(platform: string, id: string, operation: string): Promise<ApiResult> {
  return request<ApiResult>('/api/review', {
    body: JSON.stringify({ id, operation, platform }),
    method: 'POST',
  });
}

export function control(
  action: 'pause' | 'resume' | 'restart',
): Promise<ApiResult & Partial<ModerationState>> {
  return request<ApiResult & Partial<ModerationState>>('/api/control', {
    body: JSON.stringify({ action }),
    method: 'POST',
  });
}

export function saveConfig(payload: ConfigPayload): Promise<ModerationState> {
  return request<ModerationState>('/api/config', {
    body: JSON.stringify(payload),
    method: 'POST',
  });
}

export function testProvider(provider: 'OpenCode Go' | 'DeepSeek API'): Promise<ApiResult> {
  return request<ApiResult>('/api/test', {
    body: JSON.stringify({ provider }),
    method: 'POST',
  });
}

export interface HistoryImportResult {
  error?: string;
  fetched?: number;
  imported?: number;
  ok: boolean;
  skipped?: number;
}

export interface HistoryResult {
  items: ModerationItemView[];
  ok: boolean;
  total?: number;
}

export function importHistory(): Promise<HistoryImportResult> {
  return request<HistoryImportResult>('/api/history/import', {
    body: JSON.stringify({}),
    method: 'POST',
  });
}

export function fetchHistory(): Promise<HistoryResult> {
  return request<HistoryResult>('/api/history');
}

export interface CurrentDonation {
  active: boolean;
  displaySeconds?: number;
  item?: {
    id: string;
    platform: string;
    kind: string;
    username: string;
    message: string;
    amount: string;
    currency: string;
    convertedAmount: string;
    hasAudio: boolean;
    audioUrl: string;
  };
  token?: string;
}

export function fetchCurrent(): Promise<CurrentDonation> {
  return request<CurrentDonation>('/api/current');
}
