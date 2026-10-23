<script setup lang="ts">
import WebsiteNav from './WebsiteNav.vue';
</script>

<template>
  <main
    ><WebsiteNav />
    <h1>maseaaao.tv — документация</h1>
    <p class="subtitle"> Человекочитаемая документация ресурсов сайта для людей и агентов. </p>

    <p><a class="tool-link" href="tools/index.html">Инструменты стрима и версии</a></p>

    <section>
      <h2>Обзор</h2>
      <p>
        maseaaao.tv — статический сайт-хаб стримера maseaaao: стримы, клипы, соцсети и контакты.
        Публичных серверных API нет — все ресурсы отдаются как статические файлы по HTTPS.
      </p>
    </section>

    <section>
      <h2>Каталог для агентов (RFC 9727)</h2>
      <p>
        <code>GET /.well-known/api-catalog</code>
        — каталог ресурсов в формате Linkset JSON (RFC 9264). Главная страница ссылается на него
        через HTTP-заголовок <code>Link</code> с отношением <code>rel="api-catalog"</code>.
      </p>
    </section>

    <section>
      <h2>Machine-readable ресурсы</h2>
      <p><code>/manifest.webmanifest</code> — web app манифест.</p>
      <p><code>/sitemap.xml</code> — карта сайта.</p>
      <p><code>/robots.txt</code> — правила для краулеров.</p>
    </section>

    <section>
      <h2>Страницы</h2>
      <p><code>/</code> — главная: Twitch, Telegram, YouTube, Instagram, TikTok и поддержка.</p>
      <p> <code>/check.html</code> — Stream Checker: инструмент проверки встраиваемых плееров. </p>
      <p><code>/docs.html</code> — эта страница.</p>
    </section>

    <p class="muted">
      Заголовки обнаружения (RFC 8288 / RFC 9727) отдаются на главной:
      <code>api-catalog</code>
      и <code>describedby</code>.
    </p>
  </main>
</template>
