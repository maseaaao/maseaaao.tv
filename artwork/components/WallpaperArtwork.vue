<script setup lang="ts">
import logo from '../logo/logo.png';
</script>
<template>
  <main class="wallpaper-artwork" aria-label="maseaaao">
    <svg class="wallpaper-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <defs>
        <filter id="letter" color-interpolation-filters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 .956863 0 0 0 0 .952941 0 0 0 0 .92549 .2126 .7152 .0722 0 0"
          />
          <feComponentTransfer>
            <feFuncA type="linear" slope="1.7" intercept="-.45" />
          </feComponentTransfer>
        </filter>
      </defs>
      <image :href="logo" width="1024" height="1024" filter="url(#letter)" />
    </svg>
  </main>
</template>
