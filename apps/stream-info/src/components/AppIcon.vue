<script setup lang="ts">
import { computed, createStaticVNode } from 'vue';
import type { UiIcon } from '../icons';
import { brandIcon, uiIcon } from '../icons';

const props = defineProps<{ name: UiIcon | 'twitch' }>();
// Static SVG from bundled imports only: never API data or user input.
const svg = computed(() => (props.name === 'twitch' ? brandIcon('twitch') : uiIcon(props.name)));
const Svg = () => createStaticVNode(svg.value, 1);
</script>

<template>
  <span class="app-icon" aria-hidden="true"><Svg /></span>
</template>

<style scoped>
.app-icon {
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex: none;
}
</style>
