<script setup lang="ts">
import AppButton from '@maseaaao/ui/AppButton.vue';
import FieldInput from '@maseaaao/ui/FieldInput.vue';
import IconIndicator from '@maseaaao/ui/IconIndicator.vue';
</script>

<template>
  <main class="stats-shell">
    <header class="stats-heading">
      <h1>Статистика выходов</h1>
      <IconIndicator
        status="disconnected"
        label="Отключено"
        dot-id="status-dot"
        label-id="status-text"
      />
    </header>
    <div class="header-bar">
      <div class="connection-fields">
        <div class="connection-field"
          ><FieldInput
            id="target-url"
            label="Адрес OBS WebSocket"
            model-value="ws://localhost:4455/"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
        /></div>
        <div class="connection-field"
          ><FieldInput
            id="target-password"
            label="Пароль OBS WebSocket"
            model-value=""
            type="password"
            autocomplete="current-password"
        /></div>
      </div>
      <div class="connection-actions">
        <label class="remember-control"
          ><input id="remember-credentials" type="checkbox" /><span>Запомнить</span></label
        >
        <AppButton id="connect-button" variant="primary">ПОДКЛЮЧИТЬ</AppButton>
        <AppButton id="forget-button">ЗАБЫТЬ</AppButton>
      </div>
    </div>
    <div class="container">
      <div
        class="stats-scroll"
        role="region"
        aria-label="Таблица выходов: прокрутка по горизонтали"
        tabindex="0"
      >
        <div role="table" aria-label="Выходы OBS">
          <div class="row-header grid-layout" role="row">
            <span role="columnheader">Выход</span>
            <span
              class="header-cell"
              role="columnheader"
              title="Целевой FPS по пиковым значениям сессии"
              >Цель</span
            >
            <span class="header-cell" role="columnheader" title="Кадров в секунду сейчас">FPS</span>
            <span class="header-cell" role="columnheader" title="Текущий битрейт отправки"
              >Битрейт</span
            >
            <span class="header-cell" role="columnheader" title="Потеря кадров (сеть и отказы)"
              >Потери сети</span
            >
            <span
              class="header-cell"
              role="columnheader"
              title="Накопленные задержки кодирования и обработки"
              >Кодирование</span
            >
            <span class="header-cell" role="columnheader" title="Общая стабильность трансляции"
              >Состояние</span
            >
            <span class="header-cell" role="columnheader" title="Состояние процесса">Статус</span>
          </div>
          <div id="display" role="rowgroup"></div>
        </div>
      </div>
      <p class="empty-output-message">Активные выходы появятся в таблице.</p>
      <section class="history-section" aria-labelledby="history-title">
        <h2 id="history-title" class="history-title">История сессии</h2>
        <div
          class="history-scroll"
          role="region"
          aria-label="Журнал сессии: прокрутка"
          tabindex="0"
        >
          <div role="table" aria-labelledby="history-title"
            ><div id="history-log" role="rowgroup"></div
          ></div>
        </div>
        <p class="empty-history-message">Завершённые сессии появятся в журнале.</p>
      </section>
    </div>
  </main>
</template>
