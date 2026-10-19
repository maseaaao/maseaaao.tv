<script setup lang="ts">
/**
 * Точка-индикатор статуса с обязательным текстом рядом. Подтверждена
 * дублированием в Stream Info (.connection i) и OBS output-stats
 * (#status-dot[data-status]) — см. docs/ui-renewal-plan.md, этап 5.
 *
 * design-rules.md: "Статусы включают текст, не только цвет/точку" —
 * label обязателен, не опционален.
 */
defineProps<{
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  /** Текст статуса на языке продукта; компонент не хранит собственные строки. */
  label: string;
}>();
</script>

<template>
  <p class="icon-indicator" role="status">
    <span
      class="icon-indicator__dot"
      :class="`icon-indicator__dot--${status}`"
      aria-hidden="true"
    ></span>
    <span class="icon-indicator__label">{{ label }}</span>
  </p>
</template>

<style scoped>
.icon-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  min-height: var(--control-height);
  font-size: 0.93rem;
  overflow-wrap: anywhere;
}
.icon-indicator__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid currentcolor;
  background: var(--color-border-control);
}
.icon-indicator__dot--connected {
  background: var(--color-success);
  border-color: var(--color-success);
}
.icon-indicator__dot--connecting {
  background: var(--color-warning);
  border-color: var(--color-warning);
}
.icon-indicator__dot--error {
  background: var(--color-danger);
  border-color: var(--color-danger);
}
.icon-indicator__label {
  min-width: 0;
  color: var(--color-muted);
}
</style>
