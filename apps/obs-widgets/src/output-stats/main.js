('use strict');

const CONFIG = Object.freeze({
  pollIntervalMs: 500,
  requestTimeoutMs: 5_000,
  lowBitrateKbps: 100,
  rejectionPollThreshold: 4,
  targetFpsCutoff: 40,
  encoderLagRatio: 0.85,
  maxOutputs: 100,
  maxOutputNameLength: 1_024,
  maxHistoryRows: 200,
  maxMessageLength: 1_000_000,
});

const STORAGE = Object.freeze({
  credentialRecordKey: 'easy-output-stats.credentials.v1',
  databaseName: 'easy-output-stats-secure-storage',
  databaseVersion: 1,
  keyStoreName: 'crypto-keys',
  credentialKeyId: 'credentials-aes-gcm-v1',
});

const STATUS = Object.freeze({
  disconnected: 'disconnected',
  connecting: 'connecting',
  connected: 'connected',
  error: 'error',
});

const state = {
  socket: null,
  pollTimer: null,
  requestSequence: 0,
  pendingRequests: new Map(),
  pendingOutputNames: new Set(),
  listRequestPending: false,
  lastStats: new Map(),
  outputStates: new Map(),
  globalRejections: new Map(),
  encoderDropCounters: new Map(),
  peakFpsMemory: new Map(),
  activeCredentials: null,
  connectionAttempt: 0,
  identified: false,
  manualDisconnect: false,
};

const elements = {
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  targetUrl: document.getElementById('target-url'),
  targetPassword: document.getElementById('target-password'),
  rememberCredentials: document.getElementById('remember-credentials'),
  connectButton: document.getElementById('connect-button'),
  forgetButton: document.getElementById('forget-button'),
  display: document.getElementById('display'),
  historyLog: document.getElementById('history-log'),
};

function setStatus(kind, message) {
  elements.statusDot.dataset.status = kind;
  elements.statusText.textContent = message;
}

function setConnectionControls(isConnectingOrConnected) {
  elements.connectButton.textContent = isConnectingOrConnected ? 'ОТКЛЮЧИТЬ' : 'ПОДКЛЮЧИТЬ';
  elements.targetUrl.disabled = isConnectingOrConnected;
  elements.targetPassword.disabled = isConnectingOrConnected;
  elements.rememberCredentials.disabled = isConnectingOrConnected;
}

function toNonNegativeFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sanitizeOutputName(value) {
  if (typeof value !== 'string') return null;
  if (!value.trim() || value.length > CONFIG.maxOutputNameLength) return null;
  return value;
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    (host.includes(':') &&
      (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')))
  ) {
    return true;
  }

  if (!host.includes('.') && !host.includes(':')) {
    return true;
  }

  const octets = host.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function normalizeWebSocketUrl(rawValue) {
  const raw = String(rawValue ?? '').trim();
  if (!raw || raw.length > 2_048) {
    throw new Error('Адрес WebSocket пуст или слишком длинный.');
  }

  const value = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `ws://${raw}`;
  const url = new URL(value);

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Разрешены только адреса ws:// и wss://.');
  }
  if (url.username || url.password) {
    throw new Error('Данные подключения в адресе WebSocket запрещены.');
  }
  if (url.hash) {
    throw new Error('Фрагменты адреса WebSocket запрещены.');
  }
  if (url.protocol === 'ws:' && !isPrivateOrLocalHost(url.hostname)) {
    throw new Error('Для удалённых серверов используйте wss://.');
  }

  return url.toString();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    });
    request.addEventListener('error', () => reject(request.error), {
      once: true,
    });
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Транзакция IndexedDB прервана.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Ошибка транзакции IndexedDB.')),
      { once: true },
    );
  });
}

function openCredentialDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE.databaseName, STORAGE.databaseVersion);

    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORAGE.keyStoreName)) {
          database.createObjectStore(STORAGE.keyStoreName);
        }
      },
      { once: true },
    );
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Не удалось открыть IndexedDB.')),
      { once: true },
    );
    request.addEventListener(
      'blocked',
      () => reject(new Error('Обновление IndexedDB заблокировано другой страницей.')),
      { once: true },
    );
  });
}

async function getOrCreateCredentialKey() {
  const database = await openCredentialDatabase();
  try {
    // Fast path: a normal restore should not generate and then discard a new AES key.
    const readTransaction = database.transaction(STORAGE.keyStoreName, 'readonly');
    const readCompleted = transactionToPromise(readTransaction);
    const existingKey = await requestToPromise(
      readTransaction.objectStore(STORAGE.keyStoreName).get(STORAGE.credentialKeyId),
    );
    await readCompleted;
    if (typeof CryptoKey !== 'undefined' && existingKey instanceof CryptoKey) return existingKey;

    const generatedKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    // Both instances serialize the check-and-insert inside one readwrite transaction.
    const transaction = database.transaction(STORAGE.keyStoreName, 'readwrite');
    const completed = transactionToPromise(transaction);
    const store = transaction.objectStore(STORAGE.keyStoreName);
    const storedKey = await requestToPromise(store.get(STORAGE.credentialKeyId));
    if (typeof CryptoKey !== 'undefined' && storedKey instanceof CryptoKey) {
      await completed;
      return storedKey;
    }
    store.put(generatedKey, STORAGE.credentialKeyId);
    await completed;
    return generatedKey;
  } finally {
    database.close();
  }
}

async function deleteCredentialKey() {
  const database = await openCredentialDatabase();
  try {
    const transaction = database.transaction(STORAGE.keyStoreName, 'readwrite');
    transaction.objectStore(STORAGE.keyStoreName).delete(STORAGE.credentialKeyId);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

async function encryptCredentials(credentials) {
  const key = await getOrCreateCredentialKey();
  const initializationVector = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: initializationVector },
    key,
    plaintext,
  );

  return {
    version: 1,
    algorithm: 'AES-GCM',
    iv: bytesToBase64(initializationVector),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptCredentials(record) {
  if (
    !record ||
    record.version !== 1 ||
    record.algorithm !== 'AES-GCM' ||
    typeof record.iv !== 'string' ||
    typeof record.ciphertext !== 'string'
  ) {
    throw new Error('Сохранённые данные подключения имеют неверный формат.');
  }

  const key = await getOrCreateCredentialKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext),
  );
  const credentials = JSON.parse(new TextDecoder().decode(plaintext));

  if (
    !credentials ||
    typeof credentials.url !== 'string' ||
    typeof credentials.password !== 'string'
  ) {
    throw new Error('Расшифрованные данные подключения имеют неверный формат.');
  }

  return {
    url: normalizeWebSocketUrl(credentials.url),
    password: credentials.password,
  };
}

let credentialMutation = Promise.resolve();
let credentialRevision = 0;

function serializeCredentialMutation(operation) {
  const pending = credentialMutation.catch(() => undefined).then(operation);
  credentialMutation = pending.catch(() => undefined);
  return pending;
}

function saveCredentials(credentials, isCurrent = () => true) {
  const revision = ++credentialRevision;
  return serializeCredentialMutation(async () => {
    if (revision !== credentialRevision || !isCurrent()) return false;
    const record = await encryptCredentials(credentials);
    if (revision !== credentialRevision || !isCurrent()) return false;
    localStorage.setItem(STORAGE.credentialRecordKey, JSON.stringify(record));
    return true;
  });
}

async function loadCredentials() {
  const serialized = localStorage.getItem(STORAGE.credentialRecordKey);
  if (!serialized) return null;

  try {
    return await decryptCredentials(JSON.parse(serialized));
  } catch (error) {
    // A transient IndexedDB failure must never permanently erase valid credentials.
    throw new Error('Не удалось прочитать сохранённые данные. Запись сохранена; проверьте хранилище или удалите её вручную.', {
      cause: error,
    });
  }
}

function forgetCredentials() {
  const revision = ++credentialRevision;
  return serializeCredentialMutation(async () => {
    if (revision !== credentialRevision) return false;
    localStorage.removeItem(STORAGE.credentialRecordKey);
    try {
      await deleteCredentialKey();
    } catch {
      // The ciphertext is already removed. A leftover non-exportable key is harmless.
    }
    return true;
  });
}

async function getAuthHash(password, salt, challenge) {
  const encoder = new TextEncoder();
  const passwordHash = await crypto.subtle.digest('SHA-256', encoder.encode(password + salt));
  const passwordHashBase64 = bytesToBase64(new Uint8Array(passwordHash));
  const finalHash = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(passwordHashBase64 + challenge),
  );
  return bytesToBase64(new Uint8Array(finalHash));
}

function clearPolling() {
  if (state.pollTimer !== null) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function clearPendingRequests() {
  state.pendingRequests.clear();
  state.pendingOutputNames.clear();
  state.listRequestPending = false;
}

function closeCurrentSocket(code = 1000, reason = 'Client disconnect') {
  clearPolling();
  clearPendingRequests();

  const socket = state.socket;
  state.socket = null;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close(code, reason);
  }
}

function resetLiveStatistics() {
  state.lastStats.clear();
  state.outputStates.clear();
  state.globalRejections.clear();
  state.encoderDropCounters.clear();
  state.peakFpsMemory.clear();
  elements.display.replaceChildren();
}

function sendJson(payload) {
  const socket = state.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function sendRequest(requestType, requestData, outputName = null) {
  const requestId = `request-${++state.requestSequence}`;
  const request = { requestType, requestId };
  if (requestData !== undefined) request.requestData = requestData;

  const sent = sendJson({ op: 6, d: request });
  if (!sent) return false;

  state.pendingRequests.set(requestId, {
    requestType,
    outputName,
    createdAt: Date.now(),
  });
  if (requestType === 'GetOutputList') state.listRequestPending = true;
  if (outputName !== null) state.pendingOutputNames.add(outputName);
  return true;
}

function removePendingRequest(requestId, record) {
  state.pendingRequests.delete(requestId);
  if (record.requestType === 'GetOutputList') state.listRequestPending = false;
  if (record.outputName !== null) state.pendingOutputNames.delete(record.outputName);
}

function removeExpiredRequests() {
  const now = Date.now();
  for (const [requestId, record] of state.pendingRequests) {
    if (now - record.createdAt > CONFIG.requestTimeoutMs) {
      removePendingRequest(requestId, record);
    }
  }
}

function fetchData() {
  if (!state.identified) return;
  removeExpiredRequests();
  if (!state.listRequestPending) {
    sendRequest('GetOutputList', undefined);
  }
}

function createTextCell(text, classNames = [], title = '') {
  const cell = document.createElement('span');
  cell.setAttribute('role', 'cell');
  cell.textContent = String(text);
  if (classNames.length > 0) cell.classList.add(...classNames);
  if (title) cell.title = title;
  return cell;
}

function saveToHistory(name, rejections, networkDrops, encoderDrops, wasRejected) {
  const row = document.createElement('div');
  row.setAttribute('role', 'row');
  row.classList.add('history-row', wasRejected ? 'hist-rejected' : 'hist-ok');
  row.append(
    createTextCell(new Date().toLocaleTimeString()),
    createTextCell(name, ['history-output-name']),
    createTextCell(wasRejected ? 'ОТКАЗ' : 'ЗАВЕРШЕНО'),
    createTextCell(`Сеть: ${networkDrops}`),
    createTextCell(`Код.: ${encoderDrops}`),
    createTextCell(`Отказы: ${rejections}`),
  );
  elements.historyLog.prepend(row);

  while (elements.historyLog.children.length > CONFIG.maxHistoryRows) {
    elements.historyLog.lastElementChild?.remove();
  }
}

function deleteOutputState(name) {
  for (const [requestId, record] of state.pendingRequests) {
    if (record.outputName === name) removePendingRequest(requestId, record);
  }
  state.outputStates.delete(name);
  state.lastStats.delete(name);
  state.globalRejections.delete(name);
  state.encoderDropCounters.delete(name);
  state.peakFpsMemory.delete(name);
  state.pendingOutputNames.delete(name);
}

function isLocalOutput(name) {
  const lowerName = name.toLowerCase();
  return ['rec', 'virtual', 'backtrack', 'replay', 'buffer'].some((token) =>
    lowerName.includes(token),
  );
}

function handleOutputList(responseData) {
  if (!responseData || !Array.isArray(responseData.outputs)) return;

  const activeOutputs = [];
  const seenNames = new Set();

  for (const output of responseData.outputs.slice(0, CONFIG.maxOutputs)) {
    if (!output || output.outputActive !== true) continue;
    const name = sanitizeOutputName(output.outputName);
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    activeOutputs.push({ name });
  }

  for (const [name, outputState] of state.outputStates) {
    if (seenNames.has(name)) continue;

    if (!outputState.sessionSaved) {
      const rejections = state.globalRejections.get(name) ?? 0;
      const wasRejected =
        !outputState.isLocal && outputState.deadCounter >= CONFIG.rejectionPollThreshold;
      saveToHistory(
        name,
        rejections,
        outputState.outputSkippedFrames + rejections,
        state.encoderDropCounters.get(name) ?? 0,
        wasRejected,
      );
    }
    deleteOutputState(name);
  }

  if (activeOutputs.length === 0) {
    elements.display.replaceChildren();
    return;
  }

  for (const output of activeOutputs) {
    if (!state.outputStates.has(output.name)) {
      state.encoderDropCounters.set(output.name, 0);
      state.globalRejections.set(output.name, 0);
      state.lastStats.delete(output.name);
    }

    if (!state.pendingOutputNames.has(output.name)) {
      sendRequest('GetOutputStatus', { outputName: output.name }, output.name);
    }
  }
}

function handleOutputStatus(name, responseData) {
  if (!responseData || typeof responseData !== 'object') return;

  const outputBytes = toNonNegativeFiniteNumber(responseData.outputBytes);
  const outputTotalFrames = toNonNegativeFiniteNumber(responseData.outputTotalFrames);
  const outputSkippedFrames = toNonNegativeFiniteNumber(responseData.outputSkippedFrames);
  const now = Date.now();
  const previous = state.lastStats.get(name) ?? {
    bytes: outputBytes,
    frames: outputTotalFrames,
    time: now,
    zeroCount: 0,
  };
  const timeDiffSeconds = (now - previous.time) / 1_000;
  const validSample = timeDiffSeconds > 0 && timeDiffSeconds <= 5;
  const byteDelta = Math.max(0, outputBytes - previous.bytes);
  const frameDelta = Math.max(0, outputTotalFrames - previous.frames);
  const bitrate = validSample ? Math.floor((byteDelta * 8) / 1_024 / timeDiffSeconds) : 0;
  const currentFps = validSample ? Math.round(frameDelta / timeDiffSeconds) : 0;

  const previousPeak = state.peakFpsMemory.get(name) ?? 0;
  const nextPeak = Math.max(previousPeak, currentFps);
  state.peakFpsMemory.set(name, nextPeak);
  const target = nextPeak > CONFIG.targetFpsCutoff ? 60 : 30;
  const localOutput = isLocalOutput(name);

  if (validSample && bitrate > CONFIG.lowBitrateKbps) {
    const expectedFrames = target * timeDiffSeconds;
    if (frameDelta < expectedFrames * CONFIG.encoderLagRatio) {
      const previousDrops = state.encoderDropCounters.get(name) ?? 0;
      state.encoderDropCounters.set(
        name,
        previousDrops + Math.max(0, Math.round(expectedFrames - frameDelta)),
      );
    }
  }

  let zeroCount = previous.zeroCount;
  if (validSample && !localOutput && bitrate < CONFIG.lowBitrateKbps) {
    zeroCount += 1;
    if (zeroCount % CONFIG.rejectionPollThreshold === 0) {
      state.globalRejections.set(name, (state.globalRejections.get(name) ?? 0) + 1);
    }
  } else if (validSample) {
    zeroCount = 0;
  }

  state.lastStats.set(name, {
    bytes: outputBytes,
    frames: outputTotalFrames,
    time: now,
    zeroCount,
  });
  state.outputStates.set(name, {
    bitrate,
    fps: currentFps,
    target,
    name,
    deadCounter: zeroCount,
    sessionSaved: false,
    isLocal: localOutput,
    outputSkippedFrames,
  });
  render();
}

function handleRequestResponse(data) {
  if (!data || typeof data.requestId !== 'string') return;
  const record = state.pendingRequests.get(data.requestId);
  if (!record) return;
  removePendingRequest(data.requestId, record);

  if (data.requestStatus?.result === false) return;

  if (record.requestType === 'GetOutputList') {
    handleOutputList(data.responseData);
  } else if (record.requestType === 'GetOutputStatus' && record.outputName !== null) {
    handleOutputStatus(record.outputName, data.responseData);
  }
}

function render() {
  const fragment = document.createDocumentFragment();
  const sortedNames = [...state.outputStates.keys()].sort((left, right) =>
    left.localeCompare(right),
  );

  for (const name of sortedNames) {
    const output = state.outputStates.get(name);
    if (!output) continue;

    const rejected = !output.isLocal && output.deadCounter >= CONFIG.rejectionPollThreshold;
    const rejectionCount = state.globalRejections.get(name) ?? 0;
    const networkValue = output.isLocal ? '-' : output.outputSkippedFrames + rejectionCount;
    const health = output.fps < output.target * 0.8 ? 'ЗАДЕРЖКА КОДИРОВАНИЯ' : 'НОРМА';
    const encoderDrops = state.encoderDropCounters.get(name) ?? 0;

    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    row.classList.add('output-row', 'grid-layout', 'active-row');
    row.append(
      createTextCell(name, ['output-name']),
      createTextCell(output.target, ['stat-cell'], 'Целевой FPS'),
      createTextCell(
        output.fps,
        health !== 'НОРМА' ? ['stat-cell', 'warning'] : ['stat-cell'],
        'Текущий FPS',
      ),
      createTextCell(`${output.bitrate} кбит/с`, ['stat-cell'], 'Битрейт'),
      createTextCell(
        networkValue,
        networkValue !== '-' && networkValue > 0 ? ['stat-cell', 'critical'] : ['stat-cell'],
        'Кадры, потерянные в сети',
      ),
      createTextCell(
        encoderDrops,
        encoderDrops > 50 ? ['stat-cell', 'warning'] : ['stat-cell'],
        'Кадры с задержкой кодирования',
      ),
      createTextCell(
        rejected ? 'ОТКАЗ' : health,
        ['stat-cell', rejected ? 'critical' : health !== 'НОРМА' ? 'warning' : 'ok'],
        'Состояние трансляции',
      ),
      createTextCell('ЭФИР', ['stat-cell', 'live-status']),
    );
    fragment.append(row);
  }

  elements.display.replaceChildren(fragment);
}

async function handleHello(data, attempt) {
  if (attempt !== state.connectionAttempt || !state.activeCredentials) return;

  const identifyData = { rpcVersion: 1, eventSubscriptions: 0 };
  const authentication = data?.authentication;

  if (authentication !== undefined) {
    if (
      !authentication ||
      typeof authentication.salt !== 'string' ||
      typeof authentication.challenge !== 'string' ||
      authentication.salt.length > 1_024 ||
      authentication.challenge.length > 1_024
    ) {
      throw new Error('Сервер отправил неверный запрос аутентификации.');
    }
    if (!state.activeCredentials.password) {
      throw new Error('OBS WebSocket требует пароль.');
    }

    identifyData.authentication = await getAuthHash(
      state.activeCredentials.password,
      authentication.salt,
      authentication.challenge,
    );
  }

  if (attempt !== state.connectionAttempt) return;
  if (!sendJson({ op: 1, d: identifyData })) {
    throw new Error('Не удалось отправить ответ аутентификации.');
  }
}

async function handleIdentified(attempt) {
  if (attempt !== state.connectionAttempt || !state.activeCredentials) return;

  state.identified = true;
  setStatus(STATUS.connected, 'Подключено');
  setConnectionControls(true);
  fetchData();
  clearPolling();
  state.pollTimer = window.setInterval(fetchData, CONFIG.pollIntervalMs);

  const credentialsToSave = { ...state.activeCredentials };
  const stillCurrent = () => attempt === state.connectionAttempt && state.identified;
  if (!window.crypto?.subtle || !window.indexedDB) {
    credentialsToSave.password = '';
    setStatus(STATUS.connected, 'Подключено · без сохранения данных');
    return;
  }

  const remember = elements.rememberCredentials.checked;
  try {
    const applied = remember
      ? await saveCredentials(credentialsToSave, stillCurrent)
      : await forgetCredentials();
    if (!stillCurrent() || !applied) return;
    setStatus(
      STATUS.connected,
      remember ? 'Подключено · автоподключение включено' : 'Подключено · данные не сохранены',
    );
  } catch {
    if (!stillCurrent()) return;
    setStatus(
      STATUS.connected,
      remember
        ? 'Подключено · не удалось безопасно сохранить данные'
        : 'Подключено · не удалось удалить сохранённые данные',
    );
  } finally {
    credentialsToSave.password = '';
  }
}

async function handleSocketMessage(event, attempt) {
  if (attempt !== state.connectionAttempt) return;
  if (typeof event.data !== 'string' || event.data.length > CONFIG.maxMessageLength) {
    throw new Error('Сервер отправил неподдерживаемое или слишком большое сообщение.');
  }

  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    throw new Error('Сервер отправил неверный JSON.');
  }

  if (!message || !Number.isInteger(message.op)) {
    throw new Error('Сервер отправил неверное сообщение OBS WebSocket.');
  }

  if (message.op === 0) {
    await handleHello(message.d, attempt);
  } else if (message.op === 2) {
    await handleIdentified(attempt);
  } else if (message.op === 7) {
    handleRequestResponse(message.d);
  }
}

function describeCloseEvent(event) {
  if (event.code === 4009) return 'Ошибка аутентификации';
  if (event.code === 4006) return 'Неподдерживаемая версия RPC';
  if (event.code === 1000 && state.manualDisconnect) return 'Отключено';
  return `Отключено${event.code ? ` · код ${event.code}` : ''}`;
}

let connectionIntent = 0;

function connect(credentials) {
  ++connectionIntent;
  let normalizedUrl;
  try {
    normalizedUrl = normalizeWebSocketUrl(credentials.url);
  } catch (error) {
    setStatus(STATUS.error, error instanceof Error ? error.message : 'Неверный адрес');
    return;
  }

  state.manualDisconnect = false;
  state.identified = false;
  state.connectionAttempt += 1;
  const attempt = state.connectionAttempt;
  closeCurrentSocket(1000, 'Replacing connection');
  resetLiveStatistics();

  state.activeCredentials = {
    url: normalizedUrl,
    password: String(credentials.password ?? ''),
  };
  elements.targetUrl.value = normalizedUrl;
  setStatus(STATUS.connecting, 'Подключение…');
  setConnectionControls(true);

  let socket;
  try {
    socket = new WebSocket(normalizedUrl);
  } catch (error) {
    state.activeCredentials.password = '';
    state.activeCredentials = null;
    setConnectionControls(false);
    setStatus(
      STATUS.error,
      error instanceof Error ? error.message : 'Не удалось создать WebSocket',
    );
    return;
  }

  state.socket = socket;
  socket.addEventListener('open', () => {
    if (attempt === state.connectionAttempt) {
      setStatus(STATUS.connecting, 'Аутентификация…');
    }
  });
  socket.addEventListener('message', (event) => {
    void handleSocketMessage(event, attempt).catch((error) => {
      if (attempt !== state.connectionAttempt) return;
      setStatus(STATUS.error, error instanceof Error ? error.message : 'Ошибка протокола');
      closeCurrentSocket(1002, 'Ошибка протокола');
    });
  });
  socket.addEventListener('error', () => {
    if (attempt === state.connectionAttempt && !state.identified) {
      setStatus(STATUS.error, 'Не удалось подключиться к WebSocket');
    }
  });
  socket.addEventListener('close', (event) => {
    if (attempt !== state.connectionAttempt) return;
    clearPolling();
    clearPendingRequests();
    state.socket = null;
    state.identified = false;
    if (state.activeCredentials) state.activeCredentials.password = '';
    state.activeCredentials = null;
    setConnectionControls(false);
    setStatus(
      event.code === 1000 && state.manualDisconnect ? STATUS.disconnected : STATUS.error,
      describeCloseEvent(event),
    );
  });
}

function disconnect() {
  ++connectionIntent;
  state.manualDisconnect = true;
  state.connectionAttempt += 1;
  state.identified = false;
  if (state.activeCredentials) state.activeCredentials.password = '';
  state.activeCredentials = null;
  closeCurrentSocket(1000, 'User disconnect');
  setConnectionControls(false);
  setStatus(STATUS.disconnected, 'Отключено');
}

async function connectFromInputs() {
  const intent = ++connectionIntent;
  let normalizedUrl;
  try {
    normalizedUrl = normalizeWebSocketUrl(elements.targetUrl.value);
  } catch (error) {
    setStatus(STATUS.error, error instanceof Error ? error.message : 'Неверный адрес');
    return;
  }

  let password = elements.targetPassword.value;
  if (!password && elements.rememberCredentials.checked) {
    try {
      const saved = await loadCredentials();
      if (saved && saved.url === normalizedUrl) password = saved.password;
    } catch (error) {
      setStatus(
        STATUS.error,
        error instanceof Error ? error.message : 'Не удалось загрузить данные подключения',
      );
      return;
    }
  }

  if (intent === connectionIntent) connect({ url: normalizedUrl, password });
}

async function initialize() {
  elements.connectButton.addEventListener('click', () => {
    if (
      state.socket &&
      (state.socket.readyState === WebSocket.CONNECTING ||
        state.socket.readyState === WebSocket.OPEN)
    ) {
      disconnect();
    } else {
      void connectFromInputs();
    }
  });

  elements.forgetButton.addEventListener('click', () => {
    ++connectionIntent;
    void forgetCredentials().then(
      (applied) => {
        if (!applied) return;
        elements.targetPassword.value = '';
        elements.rememberCredentials.checked = false;
        setStatus(
          state.identified ? STATUS.connected : STATUS.disconnected,
          state.identified ? 'Подключено · сохранённые данные удалены' : 'Сохранённые данные удалены',
        );
      },
      () => setStatus(STATUS.error, 'Не удалось удалить сохранённые данные'),
    );
  });

  for (const input of [elements.targetUrl, elements.targetPassword]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void connectFromInputs();
    });
  }

  window.addEventListener('beforeunload', () => {
    state.manualDisconnect = true;
    closeCurrentSocket(1000, 'Page unload');
  });

  if (!window.crypto?.subtle || !window.indexedDB) {
    elements.rememberCredentials.checked = false;
    elements.rememberCredentials.disabled = true;
    elements.forgetButton.disabled = true;
    setStatus(STATUS.disconnected, 'Безопасное хранилище недоступно · можно подключиться вручную');
    return;
  }

  const startupIntent = connectionIntent;
  try {
    const savedCredentials = await loadCredentials();
    if (startupIntent !== connectionIntent) return;
    if (!savedCredentials) {
      setStatus(STATUS.disconnected, 'Отключено');
      return;
    }

    elements.targetUrl.value = savedCredentials.url;
    elements.rememberCredentials.checked = true;
    connect(savedCredentials);
    savedCredentials.password = '';
  } catch (error) {
    if (startupIntent !== connectionIntent) return;
    setStatus(
      STATUS.error,
      error instanceof Error ? error.message : 'Не удалось загрузить данные подключения',
    );
  }
}

void initialize();
