<script setup lang="ts">
import AppButton from '@maseaaao/ui/AppButton.vue';
</script>

<template>
  <header>
    <h1>Stream Checker</h1>
    <div class="global-actions">
      <AppButton type="button" inverted data-action="add-all">Добавить все</AppButton>
      <AppButton type="button" inverted data-action="remove-all" data-kind="remove"
        >Удалить все</AppButton
      >
    </div>
  </header>

  <main class="grid">
    <section class="card" data-platform="youtube">
      <div class="card-header">
        <div>
          <h2 class="title">YouTube</h2>
          <div class="status" role="status" data-status>iframe не создан</div>
        </div>

        <div class="actions">
          <AppButton type="button" data-action="add">Добавить</AppButton>
          <AppButton type="button" data-action="remove" data-kind="remove">Удалить</AppButton>
          <AppButton
            as="a"
            class="button"
            href="https://www.youtube.com/channel/UCyJNPWpOcPfMo5csKa27yGg/live"
            target="_blank"
            rel="noreferrer"
            >Открыть</AppButton
          >
        </div>
      </div>

      <div class="slot" data-slot>
        <div class="placeholder">YouTube-плеер не загружен</div>
      </div>
    </section>

    <section class="card" data-platform="twitch">
      <div class="card-header">
        <div>
          <h2 class="title">Twitch</h2>
          <div class="status" role="status" data-status>iframe не создан</div>
        </div>

        <div class="actions">
          <AppButton type="button" data-action="add">Добавить</AppButton>
          <AppButton type="button" data-action="remove" data-kind="remove">Удалить</AppButton>
          <AppButton
            as="a"
            class="button"
            href="https://www.twitch.tv/maseaaao"
            target="_blank"
            rel="noreferrer"
            >Открыть</AppButton
          >
        </div>
      </div>

      <div class="slot" data-slot>
        <div class="placeholder">Twitch-плеер не загружен</div>
      </div>
    </section>
  </main>
</template>
