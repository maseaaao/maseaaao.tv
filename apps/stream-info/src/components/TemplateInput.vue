<script setup lang="ts">
import { computed, ref, useId } from 'vue';

const props = defineProps<{
  label: string;
  modelValue: string;
  disabled?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
const id = useId();
const mirror = ref<HTMLElement | null>(null);
const parts = computed(() => props.modelValue.split(/(%subtitle%)/g));
function syncScroll(event: Event): void {
  if (event.target instanceof HTMLInputElement && mirror.value) {
    mirror.value.scrollLeft = event.target.scrollLeft;
  }
}
function input(event: Event): void {
  if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.value);
  syncScroll(event);
}
</script>

<template>
  <div class="template-input">
    <label :for="id">{{ label }}</label>
    <div class="template-input__editor" :class="{ 'is-invalid': error, 'is-disabled': disabled }">
      <div ref="mirror" class="template-input__highlight" aria-hidden="true"
        ><template v-for="(part, index) in parts" :key="index"
          ><mark v-if="part === '%subtitle%'">{{ part }}</mark
          ><template v-else>{{ part }}</template></template
        ></div
      >
      <input
        :id="id"
        name="template"
        :value="modelValue"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        :aria-invalid="Boolean(error) || undefined"
        :aria-describedby="error ? `${id}-error` : undefined"
        @input="input"
        @scroll="syncScroll"
      >
    </div>
    <p v-if="error" :id="`${id}-error`" class="template-input__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.template-input {
  display: grid;
  min-width: 0;
  gap: var(--space-2);
  font-size: 14px;
}
.template-input__editor {
  position: relative;
  min-width: 0;
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-field);
  background: var(--color-field);
}
.template-input__highlight,
input {
  width: 100%;
  margin: 0;
  border: 0;
  padding: var(--space-3);
  font: inherit;
  line-height: 1.5;
  letter-spacing: normal;
  white-space: pre;
  word-break: normal;
  tab-size: 4;
}
.template-input__highlight {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: var(--color-text);
}
mark {
  padding: 0;
  border-radius: 3px;
  color: var(--color-brand);
  background: var(--color-accent-soft);
}
input {
  position: relative;
  display: block;
  min-height: var(--control-height);
  background: transparent;
  color: transparent;
  caret-color: var(--color-text);
  border-radius: inherit;
}
input::selection {
  color: var(--color-text);
  background: var(--color-accent-soft);
}
.template-input__editor:focus-within {
  outline: 3px solid var(--color-focus);
  outline-offset: 4px;
}
input:focus-visible {
  outline: none;
}
.is-invalid {
  border-color: var(--color-danger);
}
.is-disabled {
  opacity: 0.7;
}
.template-input__error {
  color: var(--color-danger);
  font-size: 13px;
}

@media (forced-colors: active) {
  input {
    color: CanvasText;
  }
  .template-input__highlight {
    visibility: hidden;
  }
}
</style>
