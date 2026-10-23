<script setup lang="ts">
import BrandSurface from './BrandSurface.vue';

defineProps<{ platform: 'twitch' | 'youtube' }>();
</script>
<template>
  <main class="banner-viewport" :class="`${platform}-banner`">
    <div class="banner-stage"
      ><section class="banner-shell" aria-label="Баннер стрима">
        <BrandSurface class="composition"
          ><h1>ЗАЙДИ НА <span>СТРИМ</span></h1></BrandSurface
        >
      </section></div
    >
  </main>
</template>
