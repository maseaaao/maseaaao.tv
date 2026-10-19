# Сайт maseaaao.tv

Шесть маршрутов: главная, документация, Stream Checker и три страницы инструментов. Исходники страниц — `src/components/*.vue`; внешние HTML сохраняют SEO, canonical, JSON-LD и подключения продуктовых сценариев.

`npm run build:website` из корня сначала готовит Vue SSR в `.build-cache/website/ssr`, затем Vite собирает корневой `dist`. Используется общий `prepareVuePages` из build-config. Исходники и соседние приложения не переписываются; `apps/website/public` копируется побайтово. Публичный аватар и его URL сохраняются.

Vue используется только при сборке. Клиентский runtime/компилятор запрещены проверкой графа бандлов. Готовая главная содержит прежний `stream.js`, checker — `check.js`; страницы документации и инструментов не требуют JavaScript. Шрифт — один локальный Unbounded 400 с content hash и preload; основной текст — системный Arial. Лицензия OFL публикуется отдельно. Бюджеты: все клиентские модули вместе ≤12000 байт, каждая HTML-страница ≤25000 байт (без gzip).

`npm run check:ui` включает строгие типы SFC сайта. Полные композиции доступны в Storybook; режим `HomePage.preview` отключает удалённый player iframe только для offline-каталога. Stories не запускают продуктовые сценарии и не проверяют настоящий эфир.

Готовый сайт проверяется через Chromium с подставными Twitch SDK/iframe: статусы, таймаут 12 секунд, блокировка autoplay, ленивый чат, ручной выбор после resize, порог контента 402 px, TV-параметр checker и повторное создание плееров. Использовать `node --test --test-concurrency=1 tests/landing-corrections.test.mjs tests/landing-sync.test.mjs tests/operational-pages.test.mjs tests/website-build.test.mjs` из корня после сборки. Полный набор — `npm run test:website` после `build:all`.

Сайт поставляется как публикация HTTPS; это не автономный OBS HTML. Дизайн использует утверждённый эталон из `docs/ui-renewal`: синяя внешняя область, единая светлая поверхность, крупное имя, два главных действия и спокойные строки социальных ссылок. Доступные состояния проверяются на 320/390/540 px и desktop; визуальная приёмка на Windows 11/Chrome/Chromium остаётся отдельной проверкой.
