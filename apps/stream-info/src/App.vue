<script setup lang="ts">
import AppButton from '@maseaaao/ui/AppButton.vue';
import FieldInput from '@maseaaao/ui/FieldInput.vue';
import IconIndicator from '@maseaaao/ui/IconIndicator.vue';
import { computed, onScopeDispose } from 'vue';
import STREAMERBOT_IMPORT from '../streamerbot-import.txt?raw';
import AppIcon from './components/AppIcon.vue';
import NoticeBanner from './components/NoticeBanner.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import StreamNotices from './components/StreamNotices.vue';
import TwitchCard from './components/TwitchCard.vue';
import { useStreamInfo } from './composables/useStreamInfo';
import { t } from './messages';

const props = withDefaults(defineProps<{ demo?: boolean }>(), { demo: undefined });
const controller = useStreamInfo({ demo: props.demo });
const {
  state,
  settings,
  busy,
  available,
  errors,
  version,
  connectionText,
  refreshState,
  verifyAction,
  connect,
  closeNotice,
  openSettings,
  closeSettings,
  saveConnection,
  saveAll,
  runPreset,
} = controller;
const setupRequired = computed(() =>
  ['missing', 'disabled', 'outdated'].includes(state.actionStatus),
);
const setupTitle = computed(() =>
  state.actionStatus === 'outdated'
    ? t('importOutdated')
    : state.actionStatus === 'disabled'
      ? t('importDisabled', { action: 'STREAM INFO | API' })
      : t('importRequired', { action: 'STREAM INFO | API' }),
);
const saveStatus = computed(() =>
  state.allSaving
    ? t('saving')
    : state.allDirty
      ? t(state.allSaveResult === 'partial' ? 'changesPartlyApplied' : 'changesUnsaved')
      : state.allSaveResult
        ? t('changesApplied')
        : t('changesReady'),
);
const updatedAt = computed(
  () =>
    state.lastUpdated?.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) ?? '—',
);
let disposed = false;
onScopeDispose(() => {
  disposed = true;
});
function remember(event: Event): void {
  if (event.target instanceof HTMLInputElement)
    state.settingsDraft.rememberPassword = event.target.checked;
}
function retireDialog(element: Element): void {
  // The visual exit must not keep an obsolete dialog in keyboard/accessibility navigation.
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
}
async function copyImport(): Promise<void> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(STREAMERBOT_IMPORT);
    copied = true;
  } catch {
    if (disposed) return;
    const area = document.createElement('textarea');
    area.value = STREAMERBOT_IMPORT;
    area.setAttribute('aria-label', t('importAria'));
    document.body.append(area);
    area.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      area.remove();
    }
  }
  if (disposed) return;
  state.importCopied = copied;
  if (!copied)
    state.notices.unshift({
      id: crypto.randomUUID(),
      title: 'Не удалось скопировать строку',
      lines: ['Покажите строку и скопируйте её вручную.'],
      kind: 'error',
    });
}
</script>

<template>
  <div class="dock-shell" :inert="state.modal !== null || undefined">
    <div class="dock-scroll">
      <header class="dock-header"
        ><div
          ><h1>Stream Info</h1>
          <IconIndicator :status="state.connection" :label="connectionText()" /></div
        ><div class="header-actions"
          ><AppButton
            variant="icon"
            :aria-label="t('refresh')"
            :disabled="state.connection !== 'connected'"
            @click="refreshState()"
            ><template #icon><AppIcon name="refresh" /></template></AppButton
          ><AppButton variant="icon" :aria-label="t('settings')" @click="openSettings"
            ><template #icon><AppIcon name="settings" /></template></AppButton
          ></div
        ></header
      >
      <section v-if="state.authNeeded" class="auth-panel" :aria-label="t('authLabel')"
        ><NoticeBanner variant="error" :title="t('authFailed')"
          ><template #icon><AppIcon name="warning" /></template>
          {{ state.connectionError || t('authHint') }}</NoticeBanner
        ><FieldInput
          v-model="settings.password"
          :label="t('password')"
          type="password"
          autocomplete="current-password"
        /><AppButton variant="primary" @click="connect">{{ t('connect') }}</AppButton></section
      >
      <main v-if="setupRequired" class="setup-card"
        ><h2>{{ setupTitle }}</h2
        ><p v-if="state.actionStatus === 'disabled'">{{ t('importEnable') }}</p
        ><ol v-else
          ><li>Откройте Streamer.bot.</li><li>Нажмите Import.</li><li>Вставьте строку ниже.</li
          ><li>Завершите импорт.</li></ol
        ><div class="setup-actions"
          ><AppButton variant="primary" @click="copyImport"
            ><template #icon><AppIcon name="copy" /></template>
            {{ state.importCopied ? t('copied') : t('copyImport') }}</AppButton
          ><AppButton @click="state.showImport = !state.showImport">{{
            state.showImport ? t('hideImport') : t('showImport')
          }}</AppButton><AppButton @click="verifyAction">{{ t('checkAgain') }}</AppButton></div
        ><FieldInput
          v-if="state.showImport"
          :label="t('importAria')"
          :model-value="STREAMERBOT_IMPORT"
          multiline
          readonly
        /></main
      >
      <main v-else-if="state.stream" class="content">
        <TwitchCard :controller="controller" />
        <section class="preset-panel dock-section" aria-labelledby="presets-title"
          ><div class="panel-heading"
            ><h2 id="presets-title">{{ t('presets') }}</h2
            ><span class="preset-count">{{ state.presetActions.length }}</span></div
          ><div v-if="state.presetActions.length" class="preset-list"
            ><AppButton
              v-for="preset in state.presetActions"
              :key="preset.id"
              :disabled="state.runningPresetId !== null"
              :loading="state.runningPresetId === preset.id"
              @click="runPreset(preset.id, preset.name)"
              ><template #icon><AppIcon name="play" /></template>{{ preset.label }}</AppButton
            ></div
          ><p v-else class="panel-hint"
            >Добавьте Action в группу <code>STREAM INFO</code> и назовите его
            <code>PRESET | Название игры</code>.</p
          ></section
        >
      </main>
      <main v-else class="empty-state"
        ><div class="loader" aria-hidden="true"></div
        ><p role="status">{{
          state.connection === 'disconnected' ? connectionText() : t('loading')
        }}</p><p v-if="state.connectionError">{{ state.connectionError }}</p></main
      >
      <footer class="dock-footer"
        ><span>Stream Info {{ version }}</span
        ><span>{{ t('updated') }} {{ updatedAt }}</span></footer
      >
      <StreamNotices v-if="state.modal === null" :notices="state.notices" @dismiss="closeNotice" />
    </div>
    <section v-if="state.stream && !setupRequired" class="save-panel" :aria-label="t('editInfo')"
      ><p
        class="save-status"
        :class="{
          'is-dirty': state.allDirty,
          'is-saved': !state.allDirty && state.allSaveResult,
        }"
        role="status"
        aria-live="polite"
        >{{
          saveStatus
        }}</p
      ><AppButton
        variant="primary"
        :disabled="errors.length > 0 || busy || !available"
        :loading="state.allSaving"
        @click="saveAll"
        >{{
          t('applyChanges')
        }}</AppButton
      ><div v-if="errors.length" class="form-errors" role="status"
        ><p v-for="error in errors" :key="error">{{ error }}</p></div
      ></section
    >
  </div>
  <Transition name="settings" @before-leave="retireDialog">
    <SettingsDialog v-if="state.modal === 'settings'" @close="closeSettings"
      ><section class="settings-section"
        ><h3>{{ t('connectionToStreamerbot') }}</h3
        ><div class="settings-grid"
          ><FieldInput v-model="state.settingsDraft.host" label="Хост" />
          <FieldInput
            label="Порт"
            :model-value="String(state.settingsDraft.port)"
            type="number"
            :min="1"
            :max="65535"
            @update:model-value="state.settingsDraft.port = Number($event)"
          /></div
        ><FieldInput v-model="state.settingsDraft.endpoint" label="Endpoint" />
        <FieldInput
          v-model="state.settingsDraft.password"
          :label="t('password')"
          type="password"
          autocomplete="current-password"
        /><label class="check-row"
          ><input
            type="checkbox"
            :checked="state.settingsDraft.rememberPassword"
            @change="remember"
          >{{ t('rememberPassword') }}</label
        ></section
      ><StreamNotices :notices="state.notices" @dismiss="closeNotice" />
      <template #footer
        ><AppButton variant="primary" @click="saveConnection">{{
          t('saveConnection')
        }}</AppButton></template
      ></SettingsDialog
    >
  </Transition>
</template>
