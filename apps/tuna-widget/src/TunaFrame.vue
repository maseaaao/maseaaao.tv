<script setup lang="ts">
withDefaults(defineProps<{ title?: string; artist?: string; playing?: boolean }>(), {
  title: '',
  artist: '',
  playing: false,
});
</script>

<template>
  <main id="player" :data-play="playing ? '1' : '0'" data-cover="0" aria-label="Музыкальный виджет">
    <div id="surface" aria-hidden="true"></div>
    <img class="artwork-glow" alt="" aria-hidden="true" />
    <img class="artwork-glow" alt="" aria-hidden="true" />
    <div id="cover-frame" aria-hidden="true">
      <div id="cover-fallback">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 17.5V6.7c0-.55.38-1.03.92-1.16l8-1.95A1.2 1.2 0 0 1 19.4 4.76v9.3"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M9 17.5c0 1.38-1.34 2.5-3 2.5s-3-1.12-3-2.5S4.34 15 6 15s3 1.12 3 2.5Zm10.4-3.44c0 1.38-1.34 2.5-3 2.5s-3-1.12-3-2.5 1.34-2.5 3-2.5 3 1.12 3 2.5Z"
            fill="currentColor"
          />
          <path
            d="m9 9.2 10.4-2.53"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <img id="cover-a" class="cover-image" alt="" />
      <img id="cover-b" class="cover-image" alt="" />
    </div>

    <section id="content">
      <div id="track-text" class="track-text">
        <div id="title" class="track-title">{{ title }}</div>
        <div id="subtitle" class="track-subtitle" :hidden="!artist">{{ artist }}</div>
      </div>
    </section>
  </main>
</template>
