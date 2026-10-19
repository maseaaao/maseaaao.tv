<script setup>
import avatar from './avatar.webp';
</script>
<template>
  <main class="panel">
    <img :src="avatar" alt="Аватар" width="64" height="64" />
    <h1>Статическая страница</h1>
    <a href="interactive.html">Открыть форму</a>
  </main>
</template>
<style scoped>
main {
  max-width: 540px;
}
</style>
