<script setup lang="ts">
import { ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ src?: string }>();
const failed = ref(false);
const image = ref<HTMLImageElement | null>(null);
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
  { flush: 'sync' },
);
function fail(event: Event): void {
  if (
    event.target instanceof HTMLImageElement &&
    event.target === image.value &&
    event.target.getAttribute('src') === props.src
  )
    failed.value = true;
}
</script>

<template>
  <span class="category-cover">
    <img
      v-if="src && !failed"
      :key="src"
      ref="image"
      :src="src"
      alt=""
      width="48"
      height="64"
      @error="fail"
    />
    <AppIcon v-else name="defaultCategory" />
  </span>
</template>

<style scoped>
.category-cover {
  display: grid;
  place-items: center;
  width: 48px;
  height: 64px;
  flex: none;
  overflow: hidden;
  border-radius: var(--radius-tag);
  background: var(--color-accent-soft);
  color: var(--color-brand);
}
.category-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
