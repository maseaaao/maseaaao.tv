<script setup lang="ts">
/**
 * Тег/chip с опциональным удалением. Единственный текущий потребитель —
 * Stream Info (.chip, тег-инпут Twitch); второй ожидается на этапе 6
 * (сайт использует тот же паттерн в эталоне docs/ui-renewal/dock.html).
 * Решение пользователя 19.10.2026 — см. docs/ui-renewal-plan.md, этап 5.
 *
 * Валидация тега (длина/пробелы/дубли) — бизнес-правило продукта,
 * компонент только отображает значение и эмитит запрос на удаление.
 */
withDefaults(
  defineProps<{
    label: string;
    removable?: boolean;
    removeLabel?: string;
    variant?: 'neutral' | 'accent';
  }>(),
  {
    variant: 'neutral',
    removable: false,
    removeLabel: 'Удалить',
  },
);
defineEmits<{ remove: [] }>();
</script>

<template>
  <span class="chip-tag" :class="`chip-tag--${variant}`">
    <span class="chip-tag__label">{{ label }}</span>
    <button
      v-if="removable"
      type="button"
      class="chip-tag__remove"
      :aria-label="`${removeLabel}: ${label}`"
      @click="$emit('remove')"
    >
      <span aria-hidden="true">×</span>
    </button>
  </span>
</template>

<style scoped>
.chip-tag {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-tag);
  background: var(--color-field);
  color: var(--color-text);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.chip-tag__label {
  min-width: 0;
}
.chip-tag--accent {
  color: var(--color-brand);
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
}
.chip-tag__remove {
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
  font-size: 16px;
  cursor: pointer;
}
.chip-tag__remove:hover {
  background: var(--color-accent-soft);
}
.chip-tag__remove:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 2px;
}
</style>
