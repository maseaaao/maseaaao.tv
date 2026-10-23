<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
function change(event: Event): void {
  if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.checked);
}
</script>

<template>
  <label class="platform-switch"
    ><input
      type="checkbox"
      role="switch"
      aria-label="Обновлять Twitch"
      :checked="modelValue"
      :aria-checked="modelValue"
      :disabled="disabled"
      @change="change"
    ><span class="switch-track" aria-hidden="true"></span
    ><span>Twitch · {{ modelValue ? 'Включено' : 'Отключено' }}</span></label
  >
</template>

<style scoped>
.platform-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-height);
  font-size: 13px;
  cursor: pointer;
}
.platform-switch input {
  position: absolute;
  opacity: 0;
  width: 38px;
  height: 24px;
}
.switch-track {
  width: 38px;
  height: 24px;
  padding: 3px;
  border: 1px solid var(--color-border-control);
  border-radius: 20px;
  background: var(--color-field);
  flex: none;
}
.switch-track::after {
  content: '';
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-muted);
  transition: transform 160ms;
}
input:checked + .switch-track {
  background: var(--color-brand);
  border-color: var(--color-brand);
}
input:checked + .switch-track::after {
  background: var(--color-surface);
  transform: translateX(14px);
}
input:focus-visible + .switch-track {
  outline: 3px solid var(--color-focus);
  outline-offset: 4px;
}
input:disabled ~ span {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
