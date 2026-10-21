<script setup lang="ts">
defineProps<{ href: string; title: string; kind: string; primary?: boolean; verified?: boolean }>();
</script>

<template>
  <a
    :href="href"
    target="_blank"
    aria-describedby="new-window-note"
    :rel="verified ? 'me noopener noreferrer' : 'noopener noreferrer'"
    class="tile"
    :class="[`tile--${kind}`, { 'tile--primary': primary }]"
    ><span class="tile__title">{{ title }}</span></a
  >
</template>
