<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ template: string; subtitle?: string; source?: boolean }>();
const parts = computed(() => props.template.split('%subtitle%'));
</script>

<template>
  <span class="template-preview-text"
    ><template v-for="(part, index) in parts" :key="index"
      >{{ part
      }}<mark
        v-if="index < parts.length - 1"
        :class="subtitle?.trim() && !source ? 'template-value' : 'template-token'"
        >{{ source ? '%subtitle%' : subtitle?.trim() || '%subtitle%' }}</mark
      ></template
    ></span
  >
</template>

<style scoped>
.template-preview-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
mark {
  border-radius: 3px;
  padding: 1px 2px;
}
.template-token {
  background: var(--color-accent-soft);
  color: var(--color-brand);
}
.template-value {
  background: transparent;
  color: var(--color-brand);
}
</style>
