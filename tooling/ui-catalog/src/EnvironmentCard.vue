<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ title: string }>();
const count = ref(0);
</script>

<template>
  <section class="environment-card" aria-label="Проверка окружения">
    <h1>{{ title }}</h1>
    <button type="button" @click="count += 1">Изменить значение</button>
    <p role="status">Значение: {{ count }}</p>
  </section>
</template>

<style scoped>
.environment-card {
  max-width: 28rem;
  padding: 1.5rem;
  border: 1px solid var(--color-border);
  border-radius: 1rem;
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-body);
}
h1 {
  overflow-wrap: anywhere;
  font:
    400 1.5rem / 1.4 Unbounded,
    Arial,
    sans-serif;
}
button {
  min-height: 44px;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-brand);
  border-radius: 0.75rem;
  background: var(--color-brand);
  color: var(--color-surface);
  font: inherit;
}
button:focus-visible {
  outline: 3px solid var(--color-brand);
  outline-offset: 4px;
}
</style>
