<script setup lang="ts">
import qr from '@maseaaao/website/qr.png';
import { computed } from 'vue';
import logo from '../logo/logo.png';
import layout from '../scenes/layout.json';
import SceneZone from './SceneZone.vue';

const props = defineProps<{ name: string }>();
const scene = computed(() => layout.files.find((file) => file.name === props.name));
const map = computed(() =>
  scene.value?.map === 'vertical-camera'
    ? layout['vertical-camera']
    : scene.value?.map === 'vertical-status'
      ? layout['vertical-status']
      : layout.horizontal,
);
const statusMap = computed(() =>
  scene.value?.map === 'vertical-status' ? layout['vertical-status'] : layout.horizontal,
);
const vertical = computed(() => scene.value?.map !== 'horizontal');
function at(box: number[]) {
  return { left: `${box[0]}px`, top: `${box[1]}px`, width: `${box[2]}px`, height: `${box[3]}px` };
}
</script>
<template>
  <main
    v-if="scene"
    class="canvas"
    :class="[scene.kind, { vertical }]"
    :aria-label="scene.copy || 'Оформление сцены'"
    :style="{ width: `${scene.width}px`, height: `${scene.height}px` }"
  >
    <template v-if="scene.kind === 'status'">
      <div class="identity" :style="{ ...at(statusMap.identity), width: 'auto' }"
        ><img
          :src="logo"
          alt=""
          :style="{ width: `${statusMap.identity[2]}px`, height: `${statusMap.identity[3]}px` }"
        >maseaaao</div
      >
      <div class="header-rule" aria-hidden="true" :style="at(statusMap.header)"></div>
      <div class="title-field" aria-hidden="true" :style="at(statusMap.titleField)"></div>
      <h1
        :style="{
          left: `${statusMap.title[0]}px`,
          top: `${statusMap.title[1]}px`,
          fontSize: `${statusMap.titleSize}px`,
        }"
        >{{
          scene.copy
        }}</h1
      >
    </template>
    <template v-if="scene.kind === 'camera'">
      <div
        v-if="vertical"
        class="lower-background"
        aria-hidden="true"
        :style="at(layout['vertical-camera'].lowerBackground)"
      ></div>
      <div
        class="camera-frame"
        data-zone="camera"
        aria-hidden="true"
        :style="at(vertical ? layout['vertical-camera'].camera : layout.horizontal.camera)"
      ></div>
    </template>
    <template v-if="scene.kind === 'status' || scene.kind === 'camera'">
      <SceneZone name="chat" :box="map.chat" :panel="scene.kind === 'status' || vertical" />
      <SceneZone name="music" :box="map.music" /><SceneZone name="donors" :box="map.donors" />
      <SceneZone name="alerts" :box="map.alerts" />
      <SceneZone v-if="vertical" name="social" :box="map.social" />
      <img
        v-if="scene.kind === 'status' || !vertical"
        class="qr"
        data-zone="qr"
        :style="at(statusMap.qr)"
        :src="qr"
        alt="QR: maseaaao.tv"
      >
    </template>
  </main>
</template>
