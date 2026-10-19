<script setup lang="ts">
import LiveStatusBadge from '@maseaaao/ui/LiveStatusBadge.vue';
import WebsiteLink from './WebsiteLink.vue';

// The offline catalog renders layout without creating remote media frames.
withDefaults(defineProps<{ preview?: boolean }>(), { preview: false });

// Public files retain their stable URLs; these are not SFC build assets.
const avatar = '/assets/avatar-96.webp';
const avatarSizes = [64, 96, 128, 192, 288]
  .map((size) => `/assets/avatar-${size}.webp ${size}w`)
  .join(', ');
</script>

<template>
  <nav class="skip-links" aria-label="Быстрый переход">
    <a href="#platform-links">К ссылкам</a>
    <a href="#contacts">К контактам</a>
  </nav>
  <p id="new-window-note" class="sr-only">Откроется в новой вкладке.</p>
  <main class="page">
    <section class="shell" aria-labelledby="profile-name">
      <header class="identity">
        <div class="identity__top">
          <div class="avatar-shell">
            <div class="avatar-frame">
              <img
                :src="avatar"
                :srcset="avatarSizes"
                sizes="(max-width: 540px) 64px, 88px"
                alt=""
                class="avatar"
                loading="eager"
                fetchpriority="high"
                decoding="async"
                width="96"
                height="96"
                onerror="
                  this.hidden = true;
                  this.nextElementSibling.hidden = false;
                "
              />
              <div class="avatar-fallback" hidden aria-hidden="true">m</div>
            </div>
            <div class="profile-meta">
              <LiveStatusBadge
                class="live-badge"
                status="live"
                label="LIVE"
                data-live-badge
                hidden
              />
            </div>
          </div>

          <div class="identity__copy">
            <h1 id="profile-name">maseaaao</h1>
            <p class="identity__description">Стример</p>
          </div>
        </div>
      </header>

      <nav id="platform-links" class="actions" tabindex="-1" aria-label="Платформы и поддержка">
        <div class="tiles tiles--primary">
          <WebsiteLink
            href="https://www.twitch.tv/maseaaao"
            kind="twitch"
            title="Зайди на стрим"
            primary
          />
          <WebsiteLink
            href="https://www.donationalerts.com/r/maseaaao"
            kind="donationalerts"
            title="Поддержать"
          />
        </div>
        <div class="tiles tiles--secondary">
          <WebsiteLink href="https://t.me/maseaaao" kind="telegram" title="Telegram" />
          <WebsiteLink href="https://www.youtube.com/@maseaaao" kind="youtube" title="YouTube" />
          <WebsiteLink href="https://t.me/maseaaao_lobby" kind="lobby" title="Сообщество ЛОББИ" />
          <WebsiteLink
            href="https://www.instagram.com/maseaaao"
            kind="instagram"
            title="Instagram"
            verified
          />
          <WebsiteLink
            href="https://www.tiktok.com/@maseaaao"
            kind="tiktok"
            title="TikTok"
            verified
          />
          <WebsiteLink
            href="https://www.twitch.tv/maseaaao/videos"
            kind="archives"
            title="Записи стримов"
          />
        </div>
      </nav>
      <section class="stream-layout" aria-labelledby="stream-title" data-stream-layout>
        <div class="stream-content">
          <h2 id="stream-title" class="sr-only">Трансляция Twitch</h2>
          <div class="stream-status-bar">
            <p class="stream-status" role="status" aria-live="polite" data-stream-status
              >Проверяем эфир…</p
            >
            <a
              class="stream-archives"
              href="https://www.twitch.tv/maseaaao/videos"
              target="_blank"
              aria-describedby="new-window-note"
              rel="noopener noreferrer"
              >Записи Twitch ↗</a
            >
          </div>
          <div class="stream-offline" data-stream-offline hidden>
            <p class="stream-offline__title">Сейчас не в эфире</p>
            <div class="stream-offline__links">
              <a
                href="https://www.twitch.tv/maseaaao/videos"
                target="_blank"
                aria-describedby="new-window-note"
                rel="noopener noreferrer"
                >Записи Twitch ↗</a
              >
            </div>
          </div>
          <div class="stream-mobile">
            <p class="stream-fallback">Стрим и чат откроются на Twitch.</p>
          </div>
          <details class="stream-player" data-stream-player open>
            <summary hidden data-player-summary>Открыть Twitch-плеер</summary>
            <div
              id="twitch-player"
              class="twitch-player"
              role="group"
              aria-label="Twitch-плеер MASEAAAO"
            >
              <iframe
                :src="
                  preview
                    ? undefined
                    : 'https://player.twitch.tv/?channel=maseaaao&amp;parent=maseaaao.tv&amp;parent=www.maseaaao.tv&amp;parent=localhost&amp;autoplay=true&amp;muted=true'
                "
                title="Twitch-плеер MASEAAAO"
                width="600"
                height="338"
                loading="lazy"
                allow="autoplay; fullscreen"
                allowfullscreen
              >
              </iframe>
            </div>
          </details>
          <p class="stream-fallback" data-player-fallback hidden></p>
        </div>
        <details class="stream-chat" data-stream-chat>
          <summary>Чат Twitch</summary>
          <iframe
            data-chat-frame
            data-src="https://www.twitch.tv/embed/maseaaao/chat?parent=maseaaao.tv&amp;parent=www.maseaaao.tv&amp;parent=localhost"
            title="Чат Twitch MASEAAAO"
            width="320"
            height="420"
          >
          </iframe>
          <p class="stream-fallback"
            ><a
              href="https://www.twitch.tv/maseaaao"
              target="_blank"
              aria-describedby="new-window-note"
              rel="noopener noreferrer"
              >Открыть чат на Twitch ↗</a
            ></p
          >
        </details>
      </section>

      <footer id="contacts" class="collab" tabindex="-1" aria-labelledby="contacts-title">
        <h2 id="contacts-title" class="collab__label">Сотрудничество</h2>
        <div class="collab__links">
          <a class="collab__link" href="mailto:collab@maseaaao.tv">
            <span class="collab__mail">collab@maseaaao.tv</span>
            <span class="collab__arrow" aria-hidden="true">↗</span>
          </a>
          <a
            class="collab__link"
            href="https://t.me/maseaaao?direct&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82!%20%D0%9F%D0%B8%D1%88%D1%83%20%D0%BF%D0%BE%20%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81%D1%83%20%D1%81%D0%BE%D1%82%D1%80%D1%83%D0%B4%D0%BD%D0%B8%D1%87%D0%B5%D1%81%D1%82%D0%B2%D0%B0"
            target="_blank"
            aria-describedby="new-window-note"
            rel="noopener noreferrer"
          >
            <span class="collab__mail">Написать в Telegram</span>
            <span class="collab__arrow" aria-hidden="true">↗</span>
          </a>
        </div>
      </footer>
    </section>
  </main>
</template>
