<script setup lang="ts">
import BrandSurface from './BrandSurface.vue';
import logo from '../logo/logo.png';
import avatar from '../brand/rendered/website/assets/avatar-288.webp';
defineProps<{ kind: 'og' | 'subscribe' | 'background' | 'icon' }>();
</script>
<template>
  <main class="brand-artwork" :class="`${kind}-page`" aria-label="maseaaao">
    <BrandSurface v-if="kind === 'og'" class="og">
      <h1>maseaaao</h1><p>Стримы, клипы и поддержка</p><span>maseaaao.tv</span>
    </BrandSurface>
    <BrandSurface v-else-if="kind === 'subscribe'" class="subscribe">
      <img :src="avatar" alt="" /><h1>Оставайся на связи</h1> <p>Стримы, клипы, анонсы</p
      ><strong>maseaaao.tv</strong>
    </BrandSurface>
    <BrandSurface v-else-if="kind === 'background'" class="background" />
    <div v-else class="icon"><img :src="logo" alt="" /></div>
  </main>
</template>
