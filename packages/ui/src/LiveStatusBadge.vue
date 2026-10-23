<script setup lang="ts">
/**
 * Универсальный статус трансляции с текстом. Реальный потребитель —
 * Stream Info (TwitchCard); лендинг не показывает LIVE без подтверждённого
 * серверного сигнала. Не объединяется с IconIndicator — различная
 * структура и семантика.
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
    400 12px / 1.5 Unbounded,
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
