<script setup lang="ts">
/**
 * Уведомление info/warning/error/success с текстом и опциональным действием.
 * Единственный текущий потребитель — Stream Info (.notice, .notice--warning/
 * error/success); второй ожидается на этапе 6 (эталон docs/ui-renewal/dock.html
 * уже использует .notice.notice-warning). Решение пользователя 19.10.2026 —
 * см. docs/ui-renewal-plan.md, этап 5.
 *
 * design-rules.md: "Статусы включают текст, не только цвет/точку" —
 * title обязателен.
 */
withDefaults(
  defineProps<{
    variant?: 'info' | 'warning' | 'error' | 'success';
    title: string;
    dismissible?: boolean;
    dismissLabel?: string;
  }>(),
  { variant: 'info', dismissLabel: 'Скрыть' },
);
defineEmits<{ dismiss: [] }>();
defineSlots<{ default?: () => unknown; icon?: () => unknown }>();
</script>

<template>
  <div
    class="notice"
    :class="`notice--${variant}`"
    :role="variant === 'error' ? 'alert' : 'status'"
  >
    <span v-if="$slots.icon" class="notice__icon" aria-hidden="true"><slot name="icon" /></span>
    <div class="notice__body">
      <strong class="notice__title">{{ title }}</strong>
      <div v-if="$slots.default" class="notice__description"><slot /></div>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="notice__dismiss"
      :aria-label="dismissLabel"
      @click="$emit('dismiss')"
    >
      <span aria-hidden="true">×</span>
    </button>
  </div>
</template>

<style scoped>
.notice {
  --notice-color: var(--color-brand);
  --notice-background: var(--color-accent-soft);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--notice-color);
  border-radius: var(--radius-field);
  color: var(--notice-color);
  background: var(--notice-background);
  overflow-wrap: anywhere;
}
.notice--warning {
  --notice-color: var(--color-warning);
  --notice-background: color-mix(in srgb, var(--color-warning) 12%, var(--color-surface));
}
.notice--error {
  --notice-color: var(--color-danger);
  --notice-background: color-mix(in srgb, var(--color-danger) 12%, var(--color-surface));
}
.notice--success {
  --notice-color: var(--color-success);
  --notice-background: color-mix(in srgb, var(--color-success) 12%, var(--color-surface));
}
.notice__body {
  min-width: 0;
  flex: 1;
}
.notice__icon {
  display: inline-flex;
  flex: none;
  margin-top: 2px;
}
.notice__title {
  display: block;
  font-size: 1rem;
}
.notice__description {
  margin: var(--space-2) 0 0;
  color: var(--color-text);
}
.notice__dismiss {
  display: grid;
  flex: none;
  width: var(--control-height);
  height: var(--control-height);
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-tag);
  color: inherit;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
}
.notice__dismiss:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 2px;
}
</style>
