<script setup lang="ts">
defineProps<{ name: string; box: number[]; panel?: boolean }>();
</script>
<template>
  <div
    class="zone"
    :class="{ panel }"
    :data-zone="name"
    aria-hidden="true"
    :style="{
      left: `${box[0]}px`,
      top: `${box[1]}px`,
      width: `${box[2]}px`,
      height: `${box[3]}px`,
    }"
  ></div>
</template>
