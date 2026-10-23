<script setup lang="ts">
withDefaults(defineProps<{ root?: string }>(), { root: '' });
</script>

<template>
  <nav aria-label="Навигация сайта">
    <a class="tool-link" :href="`${root}index.html`">На главную</a>
    ·
    <a class="tool-link" :href="`${root}tools/index.html`">Инструменты</a>
  </nav>
</template>
