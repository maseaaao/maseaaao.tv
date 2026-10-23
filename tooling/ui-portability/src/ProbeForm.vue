<script setup lang="ts">
import { StreamerbotClient } from '@streamerbot/client';
import { computed, onUnmounted, ref } from 'vue';

const storageKey = 'maseaaao.ui-portability.v1';
function readSettings(): { port: number; title: string } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'port' in raw &&
      typeof raw.port === 'number' &&
      Number.isInteger(raw.port) &&
      raw.port > 0 &&
      raw.port <= 65535 &&
      'title' in raw &&
      typeof raw.title === 'string'
    )
      return { port: raw.port, title: raw.title };
  } catch {
    /* Storage can be denied by the host. Saving reports it explicitly. */
  }
  return { port: 0, title: '' };
}
const saved = readSettings();
const port = ref(saved.port);
const title = ref(saved.title);
const status = ref('Отключено');
const answer = ref('');
const connected = ref(false);
const canSubmit = computed(() => connected.value && title.value.trim().length > 0);
let client: StreamerbotClient | null = null;
let generation = 0;
let pendingId: string | null = null;
let timeout: ReturnType<typeof setTimeout> | undefined;

function clearPending() {
  clearTimeout(timeout);
  pendingId = null;
}
async function disconnect() {
  const owner = ++generation;
  clearPending();
  connected.value = false;
  const previous = client;
  client = null;
  await previous?.disconnect().catch(() => undefined);
  return owner;
}
async function connect() {
  if (!Number.isInteger(port.value) || port.value < 1 || port.value > 65535) {
    status.value = 'Некорректный порт';
    return;
  }
  const owner = await disconnect();
  if (owner !== generation) return;
  status.value = 'Подключение…';
  const next = new StreamerbotClient({
    host: '127.0.0.1',
    port: port.value,
    immediate: false,
    autoReconnect: false,
    password: 'probe-only',
    logLevel: 'none',
    onConnect: () => {
      if (owner === generation) {
        connected.value = true;
        status.value = 'Подключено';
      }
    },
    onDisconnect: () => {
      if (owner === generation) {
        connected.value = false;
        clearPending();
        status.value = 'Отключено';
      }
    },
    onError: () => {
      if (owner === generation) status.value = 'Ошибка подключения';
    },
  });
  client = next;
  try {
    await next.on('Custom.CodeEvent', (event) => {
      if (owner !== generation) return;
      const data: unknown = event.data;
      if (
        typeof data !== 'object' ||
        data === null ||
        !('eventName' in data) ||
        data.eventName !== 'stream_info_api_response' ||
        !('args' in data)
      )
        return;
      const result = data.args;
      if (
        typeof result !== 'object' ||
        result === null ||
        !('requestId' in result) ||
        result.requestId !== pendingId ||
        !('data' in result)
      )
        return;
      const payload = result.data;
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('title' in payload) ||
        typeof payload.title !== 'string'
      )
        return;
      clearPending();
      answer.value = payload.title;
      status.value = 'Ответ получен';
    });
    await next.connect(2000);
  } catch {
    if (owner === generation) status.value = 'Ошибка подключения';
  }
}
async function submit() {
  if (!client?.ready || !canSubmit.value) return;
  const owner = generation;
  const requestId = crypto.randomUUID();
  clearPending();
  pendingId = requestId;
  status.value = 'Ожидание ответа';
  timeout = setTimeout(() => {
    if (pendingId === requestId) {
      clearPending();
      status.value = 'Нет ответа';
    }
  }, 15000);
  try {
    await client.doAction(
      { id: 'probe-action' },
      { command: 'updateTwitch', requestId, payloadJson: JSON.stringify({ title: title.value }) },
    );
  } catch {
    if (owner === generation) {
      clearPending();
      status.value = 'Ошибка запроса';
    }
  }
}
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ port: port.value, title: title.value }));
    status.value = 'Настройки сохранены';
  } catch {
    status.value = 'Хранилище недоступно';
  }
}
onUnmounted(() => {
  void disconnect();
});
</script>

<template>
  <main>
    <h1>Автономный интерфейс</h1>
    <p>Технический образец. Подключается только к подставному источнику на этой машине.</p>
    <form @submit.prevent="submit">
      <label for="port">Порт тестового источника</label>
      <input id="port" v-model.number="port" type="number" min="1" max="65535">
      <button type="button" @click="connect">Подключиться</button>
      <label for="title">Название трансляции</label>
      <input id="title" v-model="title" maxlength="140">
      <button type="submit" :disabled="!canSubmit">Отправить</button>
      <button type="button" @click="save">Сохранить настройки</button>
    </form>
    <p role="status">{{ status }}</p>
    <output aria-label="Ответ источника">{{ answer }}</output>
  </main>
</template>
