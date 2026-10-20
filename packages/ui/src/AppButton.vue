<script setup lang="ts">
/**
 * Общая кнопка-действие. Подтверждена дублированием в Stream Info (.button/.icon-button),
 * website (.tile/кнопки чекера) —
 * см. docs/ui-renewal-plan.md, этап 5.
 *
 * Не делает сетевых вызовов и не содержит бизнес-логики: обработчик клика,
 * навигация и aria-label конкретного действия остаются в потребителе.
 */
withDefaults(
  defineProps<{
    /** Визуальный вес действия. primary — одно главное действие на экран. */
    variant?: 'primary' | 'secondary' | 'icon';
    /** Рендерит <a> вместо <button> для внешних/внутренних переходов. */
    as?: 'button' | 'a';
    href?: string;
    /** HTML type для as="button"; игнорируется для as="a". */
    type?: 'button' | 'submit';
    disabled?: boolean;
    /**
     * Сохраняет подпись и ширину действия, блокирует повторную отправку —
     * design-rules.md: "Loading сохраняет подпись и ширину действия,
     * повторная запись заблокирована".
     */
    loading?: boolean;
    /** Светлое действие на фирменном синем фоне, не отдельная тёмная тема. */
    inverted?: boolean;
    /** Необязательная обратная связь нажатия; отключена при reduced-motion. */
    pressEffect?: boolean;
    target?: string;
    rel?: string;
    ariaLabel?: string;
  }>(),
  {
    variant: 'secondary',
    as: 'button',
    type: 'button',
    inverted: false,
    pressEffect: false,
    href: undefined,
    target: undefined,
    rel: undefined,
    ariaLabel: undefined,
  },
);

defineEmits<{ click: [MouseEvent] }>();

defineSlots<{
  /** Текст/содержимое действия. */
  default?: () => unknown;
  /** Иконка слева от текста; для variant="icon" — единственное содержимое. */
  icon?: () => unknown;
}>();
</script>

<template>
  <a
    v-if="as === 'a'"
    class="app-button"
    :class="[
      `app-button--${variant}`,
      {
        'app-button--loading': loading,
        'app-button--inverted': inverted,
        'app-button--press': pressEffect,
      },
    ]"
    :href="disabled || loading ? undefined : href"
    :target="target"
    :rel="rel"
    :aria-disabled="disabled || loading || undefined"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    @click="(event) => (disabled || loading ? event.preventDefault() : $emit('click', event))"
  >
    <span v-if="$slots.icon" class="app-button__icon" aria-hidden="true"><slot name="icon" /></span>
    <span v-if="$slots.default" class="app-button__label"><slot /></span>
  </a>
  <button
    v-else
    class="app-button"
    :class="[
      `app-button--${variant}`,
      {
        'app-button--loading': loading,
        'app-button--inverted': inverted,
        'app-button--press': pressEffect,
      },
    ]"
    :type="type"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    @click="$emit('click', $event)"
  >
    <span v-if="$slots.icon" class="app-button__icon" aria-hidden="true"><slot name="icon" /></span>
    <span v-if="$slots.default" class="app-button__label"><slot /></span>
  </button>
</template>

<style scoped>
.app-button {
  display: inline-flex;
  box-sizing: border-box;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--control-height);
  min-width: var(--control-height);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-field);
  background: transparent;
  color: var(--color-text);
  font:
    400 16px/1.4 Unbounded,
    Arial,
    sans-serif;
  text-decoration: none;
  max-width: 100%;
  text-align: center;
  overflow-wrap: anywhere;
  transition:
    color 160ms,
    background-color 160ms,
    border-color 160ms;
}
.app-button__label {
  min-width: 0;
}
.app-button--primary {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--color-surface);
}
.app-button--icon {
  padding: 0;
  border-radius: var(--radius-tag);
}
.app-button--loading {
  cursor: progress;
}
.app-button:disabled,
.app-button[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.7;
}

@media (hover: hover) {
  .app-button:hover:not(:disabled, [aria-disabled='true']) {
    color: var(--color-brand);
    border-color: var(--color-brand);
    background: var(--color-accent-soft);
  }
  .app-button--primary:hover:not(:disabled, [aria-disabled='true']) {
    color: var(--color-surface);
    background: var(--color-action-hover);
    border-color: var(--color-action-hover);
  }
}
.app-button:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 4px;
}
.app-button--inverted {
  color: var(--color-surface);
  border-color: var(--color-surface);
}
.app-button--inverted:focus-visible {
  outline-color: var(--color-surface);
}
.app-button--press:active:not(:disabled, [aria-disabled='true']) {
  transform: scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .app-button {
    transition: none;
  }
  .app-button--press:active:not(:disabled, [aria-disabled='true']) {
    transform: none;
  }
}
</style>
