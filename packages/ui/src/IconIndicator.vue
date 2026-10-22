<script setup lang="ts">
/**
 * Точка-индикатор статуса с обязательным текстом рядом для Stream Info
 * (.connection i) — см. docs/ui-renewal-plan.md, этап 5.
 *
 * design-rules.md: "Статусы включают текст, не только цвет/точку" —
 * label обязателен, не опционален.
 */
defineProps<{
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  /** Текст статуса на языке продукта; компонент не хранит собственные строки. */
  label: string;
  inverted?: boolean;
  dotId?: string;
  labelId?: string;
}>();
</script>

<template>
  <p class="icon-indicator" :class="{ 'icon-indicator--inverted': inverted }" role="status">
    <span :id="dotId" class="icon-indicator__dot" :data-status="status" aria-hidden="true"></span>
    <span :id="labelId" class="icon-indicator__label">{{ label }}</span>
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
.icon-indicator__dot[data-status='connected'] {
  animation: var(--connection-motion, connection-settle) var(--motion-scene)
    var(--motion-ease-spring);
  background: var(--color-success);
  border-color: var(--color-success);
}
.icon-indicator__dot[data-status='connecting'] {
  background: var(--color-warning);
  border-color: var(--color-warning);
}
.icon-indicator__dot[data-status='error'] {
  background: var(--color-danger);
  border-color: var(--color-danger);
}
.icon-indicator__label {
  min-width: 0;
  color: var(--color-muted);
}
.icon-indicator--inverted .icon-indicator__label {
  color: var(--color-surface);
}
.icon-indicator--inverted .icon-indicator__dot {
  background: var(--color-surface);
  border-color: var(--color-surface);
}
.icon-indicator--inverted .icon-indicator__dot[data-status='connected'] {
  animation: var(--connection-motion, connection-settle) var(--motion-scene)
    var(--motion-ease-spring);
  background: color-mix(in srgb, var(--color-success) 25%, var(--color-surface));
}
.icon-indicator--inverted .icon-indicator__dot[data-status='connecting'] {
  background: color-mix(in srgb, var(--color-warning) 25%, var(--color-surface));
}
.icon-indicator--inverted .icon-indicator__dot[data-status='error'] {
  background: color-mix(in srgb, var(--color-danger) 25%, var(--color-surface));
}

@keyframes connection-settle {
  from {
    transform: scale(0.65);
  }
  to {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .icon-indicator__dot {
    --connection-motion: none;
  }
}
</style>
