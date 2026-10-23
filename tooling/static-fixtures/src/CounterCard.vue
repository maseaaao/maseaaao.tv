<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>
<template>
  <main class="panel">
    <h1>Интерактивный блок</h1>
    <button type="button" @click="count += 1">Изменить</button>
    <output>Значение: {{ count }}</output>
  </main>
</template>
<style scoped>
output {
  display: block;
  padding: 1rem;
}
</style>
