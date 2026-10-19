<script setup lang="ts">
defineProps<{ kind: 'about' | 'rules' | 'donate' | 'devices' | 'specs'; title: string }>();
</script>
<template>
  <main class="twitch-panel" :aria-label="`Twitch панель: ${title}`">
    <span
      class="twitch-panel__mark"
      :class="`twitch-panel__mark--${kind}`"
      aria-hidden="true"
    ></span>
    <h1 class="twitch-panel__title">{{ title }}</h1>
  </main>
</template>
