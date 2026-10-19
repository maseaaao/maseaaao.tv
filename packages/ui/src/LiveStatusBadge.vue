<script setup lang="ts">
/**
 * Бейдж-пилюля состояния трансляции с текстом. Единственный текущий
 * потребитель — website (.live-badge/.live-badge__dot); второй ожидается
 * на этапе 6 (Stream Info при переносе .connection на общий визуальный
 * язык). Решение пользователя 19.10.2026 — см. docs/ui-renewal-plan.md,
 * этап 5. Не объединяется с IconIndicator: разная разметка (пилюля vs
 * точка рядом с текстом) и разная семантика использования.
 */
defineProps<{
  status: 'live' | 'offline' | 'disconnected';
  label: string;
}>();
</script>

<template>
  <span class="live-status-badge" :class="`live-status-badge--${status}`" role="status">
    <span class="live-status-badge__dot" aria-hidden="true"></span>
    {{ label }}
  </span>
</template>

<style scoped>
.live-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-tag);
  background: var(--color-surface);
  color: var(--color-muted);
  font:
    600 11px/1.5 Unbounded,
    Arial,
    sans-serif;
}
.live-status-badge__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentcolor;
}
.live-status-badge--live {
  color: var(--color-success);
}
.live-status-badge--disconnected {
  color: var(--color-danger);
}
</style>
