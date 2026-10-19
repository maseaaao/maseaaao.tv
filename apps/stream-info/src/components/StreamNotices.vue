<script setup lang="ts">
import NoticeBanner from './NoticeBanner.vue';
import AppIcon from './AppIcon.vue';
import type { Notice } from '../composables/useStreamInfo';
import { t } from '../messages';

defineProps<{ notices: Notice[] }>();
const emit = defineEmits<{ dismiss: [id: string] }>();
</script>

<template>
  <div class="notices"
    ><NoticeBanner
      v-for="notice in notices"
      :key="notice.id"
      :variant="notice.kind"
      :title="notice.title"
      dismissible
      :dismiss-label="t('closeNotice')"
      @dismiss="emit('dismiss', notice.id)"
      ><template #icon
        ><AppIcon
          :name="
            notice.kind === 'error'
              ? 'error'
              : notice.kind === 'warning'
                ? 'warning'
                : notice.kind === 'success'
                  ? 'check'
                  : 'info'
          " /></template
      ><span v-for="line in notice.lines" :key="line" class="notice-line">{{
        line
      }}</span></NoticeBanner
    ></div
  >
</template>
