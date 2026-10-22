<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, useId, watch } from 'vue';
import AppButton from '@maseaaao/ui/AppButton.vue';
import CategoryCover from './CategoryCover.vue';
import { rankCategories } from '../category-search';
import { t } from '../messages';
import type { TwitchCategory } from '../types';
const props = defineProps<{
  selected: TwitchCategory | null;
  query: string;
  results: TwitchCategory[];
  disabled: boolean;
  loading: boolean;
  error: string | null;
  partial: boolean;
  warnings: string[];
  hasMore: boolean;
  limit: number;
}>();
const emit = defineEmits<{
  query: [string, boolean];
  choose: [string];
  retry: [];
  more: [];
  composition: [];
}>();
const id = useId();
const input = ref<HTMLInputElement | null>(null);
const actions = ref<HTMLDivElement | null>(null);
const active = ref<string | null>(null);
const composing = ref(false);
let disposed = false;
onScopeDispose(() => {
  disposed = true;
});
const ranked = computed(() => rankCategories(props.results, props.query));
const results = computed(() => ranked.value.slice(0, props.limit));
const expanded = computed(() => props.query.trim().length >= 2 && !props.disabled);
const more = computed(() => ranked.value.length > props.limit || props.hasMore);
const status = computed(() =>
  props.loading
    ? t('categorySearching')
    : props.error ||
      (!results.value.length && !more.value
        ? t('nothingFound')
        : t('categoryResultCount', { count: results.value.length })),
);
function optionId(value: string): string {
  return `${id}-option-${encodeURIComponent(value)}`;
}
watch(more, (hasMore, hadMore) => {
  if (!hasMore && hadMore && actions.value?.contains(document.activeElement)) {
    void nextTick(() => {
      // Only replace focus lost with the removed action, never a newer focus target.
      if (!disposed && expanded.value && document.activeElement === document.body)
        input.value?.focus();
    });
  }
});
watch(
  () => props.query,
  () => {
    active.value = null;
  },
);
watch(results, (items) => {
  if (!items.some((item) => item.id === active.value)) active.value = null;
});
function update(event: Event): void {
  if (event.target instanceof HTMLInputElement) emit('query', event.target.value, composing.value);
}
function compositionEnd(event: CompositionEvent): void {
  composing.value = false;
  update(event);
}
function choose(value: string): void {
  emit('choose', value);
  active.value = null;
  void nextTick(() => input.value?.focus());
}
async function keydown(event: KeyboardEvent, option?: string): Promise<void> {
  if (event.isComposing || composing.value || props.disabled) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const index = results.value.findIndex((item) => item.id === (option ?? active.value));
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      index < 0
        ? direction === 1
          ? 0
          : results.value.length - 1
        : (index + direction + results.value.length) % results.value.length;
    active.value = results.value[next]?.id ?? null;
    input.value?.focus();
    await nextTick();
    if (disposed) return;
    if (active.value)
      document.getElementById(optionId(active.value))?.scrollIntoView?.({ block: 'nearest' });
  } else if (event.key === 'Enter' && !option && active.value) {
    event.preventDefault();
    choose(active.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('query', '', false);
    input.value?.focus();
  }
}
</script>

<template>
  <div class="autocomplete">
    <div v-if="selected" class="selected-category"
      ><CategoryCover :src="selected.imageUrl" /><strong>{{ selected.name }}</strong></div
    >
    <label class="category-label" :for="`${id}-input`">{{ t('category') }}</label>
    <input
      :id="`${id}-input`"
      ref="input"
      class="category-query"
      :value="query"
      :placeholder="t(selected ? 'categorySearchOther' : 'categorySearch')"
      :disabled="disabled"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="expanded"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="expanded && active ? optionId(active) : undefined"
      @input="update"
      @keydown="keydown($event)"
      @compositionstart="
        composing = true;
        emit('composition');
      "
      @compositionend="compositionEnd"
    />
    <div v-if="expanded" class="category-popover">
      <div :id="`${id}-list`" class="autocomplete-list" role="listbox" :aria-label="t('category')">
        <button
          v-for="category in results"
          :id="optionId(category.id)"
          :key="category.id"
          type="button"
          class="category-option"
          role="option"
          :aria-selected="active === category.id"
          @click="choose(category.id)"
          @keydown="keydown($event, category.id)"
          ><CategoryCover :src="category.imageUrl" /><strong>{{ category.name }}</strong></button
        >
      </div>
      <p class="category-search-status" :role="error ? 'alert' : 'status'" aria-live="polite">{{
        status
      }}</p>
      <div v-if="partial" class="category-search-warning" role="status"
        >{{ t('categoryPartial')
        }}<p v-for="warning in warnings" :key="warning">{{ warning }}</p></div
      >
      <div ref="actions" class="category-search-actions"
        ><AppButton v-if="error" @click="emit('retry')">{{ t('categoryRetry') }}</AppButton
        ><AppButton v-if="more" :aria-disabled="loading" @click="!loading && emit('more')">{{
          t('categoryMore')
        }}</AppButton></div
      >
    </div>
  </div>
</template>

<style scoped>
.autocomplete {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
.selected-category {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-field);
  margin-bottom: var(--space-2);
}
.selected-category strong,
.category-option strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 15px;
}
.category-label {
  font-size: 14px;
}
.category-query {
  width: 100%;
  min-height: var(--control-height);
  padding: var(--space-3);
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-field);
  color: var(--color-text);
  background: var(--color-field);
}
.category-popover {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-field);
  overflow: hidden;
  background: var(--color-field);
  animation: dock-arrival var(--motion-enter) var(--motion-ease-enter);
}
.autocomplete-list {
  max-height: 290px;
  overflow-y: auto;
}
.category-option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  transition: background-color var(--motion-feedback) var(--motion-ease-state);
}
.category-option:hover,
.category-option[aria-selected='true'] {
  background: var(--color-accent-soft);
}
.category-search-status,
.category-search-warning {
  padding: var(--space-3);
  font-size: 13px;
}
.category-search-warning {
  color: var(--color-warning);
}
.category-search-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-2);
}
</style>
