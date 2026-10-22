<script setup lang="ts">
import BrandSurface from './BrandSurface.vue';
import logo from '../logo/logo.png';
</script>
<template>
  <main class="banner-viewport offline-banner" aria-label="Баннер видеопроигрывателя Twitch">
    <div class="banner-stage">
      <section class="banner-shell" aria-label="maseaaao — не в эфире">
        <BrandSurface class="composition offline-card">
          <img class="offline-mark" :src="logo" alt="maseaaao" />
          <h1>СЕЙЧАС НЕ В ЭФИРЕ</h1>
          <p class="offline-note">Анонсы стримов — в Telegram</p>
          <p class="offline-link">t.me/maseaaao</p>
        </BrandSurface>
      </section>
    </div>
  </main>
</template>
