<script setup lang="ts">
import { computed } from 'vue';
import AppButton from '@maseaaao/ui/AppButton.vue';
import FieldInput from '@maseaaao/ui/FieldInput.vue';
import TemplateInput from './TemplateInput.vue';
import ChipTag from './ChipTag.vue';
import LiveStatusBadge from '@maseaaao/ui/LiveStatusBadge.vue';
import AppIcon from './AppIcon.vue';
import CategorySearch from './CategorySearch.vue';
import TemplatePreview from './TemplatePreview.vue';
import { t } from '../messages';
import { isTemplateValid } from '../templates';
import type { useStreamInfo } from '../composables/useStreamInfo';
const props = defineProps<{ controller: ReturnType<typeof useStreamInfo> }>();
const {
  state,
  search,
  busy,
  available,
  title,
  setSubtitle,
  setTemplate,
  setCategoryQuery,
  setTagDraft,
  removeTag,
  addTag,
  chooseCategory,
  retrySearch,
  moreCategories,
  resetCategorySearch,
  cardStatus,
} = props.controller;
const templateValid = computed(() => isTemplateValid(state.templateDraft.twitchTemplate));
const disabled = computed(() => !available.value || busy.value);
const status = computed(() => cardStatus('twitch'));
const login = computed(() => state.stream?.twitch.login || '');
function tagKeydown(event: KeyboardEvent): void {
  if (event.isComposing || disabled.value) return;
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    addTag();
  } else if (
    event.key === 'Backspace' &&
    !state.allForm?.twitchTagDraft &&
    state.allForm?.twitchTags.length
  )
    removeTag(state.allForm.twitchTags.length - 1);
}
</script>

<template>
  <section
    class="platform-card dock-section"
    :class="[
      status,
      { 'card-error': state.cardErrors.twitch },
      state.cardEffects.twitch ? `card-${state.cardEffects.twitch}` : '',
    ]"
    data-platform="twitch"
    aria-label="Twitch"
    :aria-busy="state.loadingPlatforms.has('twitch')"
  >
    <header class="card-heading"
      ><div class="account-heading"
        ><AppIcon name="twitch" class="account-icon" /><div
          ><h2>Twitch</h2
          ><p>{{ state.stream?.twitch.accountName || t('accountNotConnected') }}</p></div
        ></div
      ><LiveStatusBadge
        :status="status"
        :label="t(status === 'live' ? 'live' : status === 'offline' ? 'offline' : 'notConnected')"
    /></header>
    <p v-if="state.loadingPlatforms.has('twitch')" class="field-note" role="status">{{
      t('updating')
    }}</p>
    <fieldset v-if="state.allForm" class="inline-editor" :disabled="disabled">
      <legend class="sr-only">{{ t('editInfo') }} Twitch</legend>
      <div class="title-fields">
        <FieldInput
          label="Название"
          name="title"
          autocomplete="off"
          :model-value="state.allForm.subtitle"
          :disabled="disabled"
          :placeholder="t('subtitleExample')"
          @update:model-value="setSubtitle"
        />
        <TemplateInput
          :label="t('twitchTemplate')"
          name="template"
          autocomplete="off"
          :model-value="state.templateDraft.twitchTemplate"
          :disabled="disabled"
          :error="templateValid ? undefined : t('templateValidation')"
          spellcheck="false"
          @update:model-value="setTemplate"
        />
      </div>
      <div class="title-preview">
        <span class="field-note">{{ t('finalTitle') }}</span>
        <strong
          ><TemplatePreview
            :template="state.templateDraft.twitchTemplate"
            :subtitle="state.allForm.subtitle"
        /></strong>
        <span class="counter" :class="{ invalid: title.length > 140 }"
          >{{ title.length }} / 140</span
        >
      </div>
      <p class="template-dirty" role="status">{{
        state.templatesDirty ? t('templatesUnsaved') : ''
      }}</p>
      <CategorySearch
        :selected="state.allForm.twitchCategory"
        :query="state.allForm.twitchCategoryQuery"
        :results="state.twitchResults"
        :disabled="disabled"
        :loading="search.twitchSearching"
        :error="search.searchError"
        :partial="search.searchPartial"
        :warnings="search.searchWarnings"
        :has-more="search.searchHasMore"
        :limit="search.visibleCategories"
        @query="setCategoryQuery"
        @choose="chooseCategory"
        @retry="retrySearch"
        @more="moreCategories"
        @composition="resetCategorySearch"
      />
      <div class="tag-editor"
        ><FieldInput
          :label="t('addTag')"
          :model-value="state.allForm.twitchTagDraft"
          :disabled="disabled"
          placeholder="Например, Русский"
          @update:model-value="setTagDraft"
          @keydown="tagKeydown" /><div class="tag-list" aria-label="Выбранные теги"
          ><ChipTag
            v-for="(tag, index) in state.allForm.twitchTags"
            :key="`${index}-${tag}`"
            :label="tag"
            variant="neutral"
            :removable="!disabled"
            remove-label="Удалить тег"
            @remove="removeTag(index)" /></div
      ></div>
      <p v-if="!available" class="account-warning">{{ t('accountNotConnected') }}</p>
    </fieldset>
    <footer class="card-footer"
      ><AppButton
        as="a"
        :href="login ? `https://www.twitch.tv/${encodeURIComponent(login)}` : undefined"
        target="_blank"
        rel="noopener noreferrer"
        variant="icon"
        :disabled="!login"
        :aria-label="t('openStream')"
        ><template #icon><AppIcon name="external" /></template></AppButton
      ><AppButton
        as="a"
        :href="
          login
            ? `https://dashboard.twitch.tv/u/${encodeURIComponent(login)}/stream-manager`
            : undefined
        "
        target="_blank"
        rel="noopener noreferrer"
        variant="icon"
        :disabled="!login"
        :aria-label="t('openDashboard')"
        ><template #icon><AppIcon name="dashboard" /></template></AppButton
    ></footer>
  </section>
</template>

<style scoped>
.card-heading,
.account-heading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.card-heading {
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}
.card-heading h2 {
  margin: 0;
  font-size: 19px;
}
.account-heading p {
  margin-top: var(--space-1);
  color: var(--color-muted);
  font-size: 12px;
}
.inline-editor {
  min-width: 0;
  display: grid;
  gap: var(--space-5);
  margin: 0;
  padding: 0;
  border: 0;
}
.account-icon {
  width: 36px;
  height: 36px;
  color: var(--color-brand);
}
.account-heading > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.title-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
}

@media (width < 390px) {
  .title-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
.title-preview {
  display: grid;
  gap: var(--space-2);
  padding-left: var(--space-3);
  border-left: 3px solid var(--color-brand);
}
.title-preview strong {
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  font-weight: 400;
}
.tag-list {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}
.card-footer {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-top: var(--space-4);
}
.account-warning {
  color: var(--color-warning);
  font-size: 13px;
}
.card-error {
  border-color: var(--color-danger);
}
.card-success {
  animation: success 3s;
}
.card-flash-error {
  animation: failure 5s;
}

@keyframes success {
  0%,
  35% {
    box-shadow: inset 3px 0 var(--color-success);
  }
  100% {
    box-shadow: inset 0 0 transparent;
  }
}

@keyframes failure {
  0%,
  35% {
    box-shadow: inset 3px 0 var(--color-danger);
  }
  100% {
    box-shadow: inset 0 0 transparent;
  }
}
</style>
