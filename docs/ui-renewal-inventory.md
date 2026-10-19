# Реестр UI: контракты и исходная база

Этап 1 [плана](ui-renewal-plan.md), 19.10.2026. Реестр получен чтением исходников, конфигураций сборки и тестов. Описанные проверки — требования и существующее покрытие, а не утверждение об их прохождении в новой архитектуре. Точные размеры и SHA-256 всех текущих конечных файлов, публичных ресурсов и шрифтов: [исходная база](ui-renewal-baseline.json). Hash bundles относится к этой исходной базе, после пересборки меняется.

## Границы и владельцы

Владелец ниже — каталог продукта или генератор в репозитории, а не назначенный человек. Перенос затрагивает браузерный UI и artwork. C# API v4, импорт Streamer.bot, ID Actions и Companion остаются совместимыми; интеграции и живые конфигурации не являются объектом визуальной миграции. В дереве apps/packages нет каталогов web-api или graphql. Источники контрактов Stream Info — C# action.cs, category-search-*.cs, state-cache-policy.cs, типы установленного @streamerbot/client и fixtures; локальный types.ts сам по себе не доказывает валидность сетевых данных.

## Source → build → output → потребитель → проверка

Все пути относительно корня. Каждая строка с набором охватывает перечисленные конечные файлы; ниже дан полный пофайловый список текущих результатов.

| Source                                                                                        | Команда / обработка                                    | Output                                                                                                    | Потребитель и поведение                                                           | Проверка                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| apps/website/src/index.html + assets/stream.js                                                | build:website, Vite                                    | dist/index.html, bundles JS/CSS/WOFF2, licenses/Unbounded-OFL.txt                                         | `/` и `/index.html`: профиль, соцсети, поддержка, контакты, Twitch SDK/iframe/чат | landing-sync, landing-corrections, landing-upstream fixture                                          |
| apps/website/src/check.html + assets/check.js                                                 | build:website                                          | dist/check.html + bundles                                                                                 | `/check.html`, `?tv=1`: добавить/удалить YouTube/Twitch по одному/все             | operational-pages                                                                                    |
| apps/website/src/docs.html                                                                    | build:website                                          | dist/docs.html                                                                                            | `/docs.html`: справка, переход к инструментам                                     | operational-pages, build-contract                                                                    |
| apps/website/src/tools/index.html                                                             | build:website                                          | dist/tools/index.html                                                                                     | `/tools/`, `/tools/index.html`: каталог двух продуктов                            | build-contract, check-repository                                                                     |
| apps/website/src/tools/stream-info.html                                                       | build:website                                          | dist/tools/stream-info.html                                                                               | описание дока, ссылки на исходники и прежние релизы                               | build-contract, check-repository                                                                     |
| apps/website/src/tools/tuna-widget.html                                                       | build:website                                          | dist/tools/tuna-widget.html                                                                               | описание музыкального виджета, ссылка на исходники                                | build-contract, check-repository                                                                     |
| apps/website/public, включая .well-known                                                      | копирование build:website                              | dist по тем же относительным путям                                                                        | Cloudflare, SEO, discovery, manifest, иконки, аватар, QR, OG                      | check-repository: побайтовое равенство                                                               |
| apps/stream-info/src + streamerbot/*.cs                                                       | generate-import → tsc → Vite singlefile → verify-build | apps/stream-info/dist/change-info-streamer-bot.ru.html; apps/stream-info/streamerbot-import.txt           | локальный док OBS, WebSocket Streamer.bot; импорт C# отдельно                     | tests/main, category-search, icons, ui; templates.ts через main tests; verify-import/build; C# tests |
| apps/tuna-widget/src                                                                          | build:tuna, singlefile                                 | apps/tuna-widget/dist/obs-tuna-widget.html                                                                | локальный browser source OBS, HTTP Tuna и обложка                                 | tuna-widget.test.mjs: file://, подставной HTTP                                                       |
| apps/obs-widgets/src/social-strip                                                             | build:widgets → Vite singlefile                        | apps/obs-widgets/dist/social-strip/index.html + transparent.png                                           | соцполоса, CSS-анимация; PNG — совместимый ресурс, HTML его не загружает          | obs-widgets-residual, build-contract                                                                 |
| apps/obs-widgets/src/output-stats                                                             | build:widgets → Vite singlefile + nonce                | apps/obs-widgets/dist/output-stats/index.html                                                             | статистика OBS WebSocket v5; подключение, безопасное хранение, журнал             | obs-widgets, obs-widgets-residual                                                                    |
| apps/obs-widgets/src/streamlabs-chat                                                          | build:widgets → PostCSS CSS, копирование HTML/JS       | dist/streamlabs-chat/{chat-box.css,chat-box.html,chat-box.js,donationalerts-alerts.css} внутри приложения | поля провайдеров Streamlabs / DonationAlerts; не самостоятельный док              | build-contract, obs-widgets-residual; fixtures placeholders                                          |
| apps/obs-widgets/src/donors                                                                   | build:widgets → PostCSS                                | apps/obs-widgets/dist/donors/donationalerts-stream-stats.css                                              | CSS статистики DonationAlerts                                                     | build-contract, obs-widgets-residual                                                                 |
| apps/obs-widgets/src/sounds                                                                   | build:widgets → copy                                   | apps/obs-widgets/dist/sounds/{health-warning.mp3,notif.mp3}                                               | ресурсы звука; не запускать при миграции                                          | obs-widgets-residual                                                                                 |
| artwork/logo/logo.png                                                                         | render:logo, Sharp                                     | artwork/logo/rendered/_, пять public/assets/avatar-_.webp, public/assets/maseaaao.tv.png                  | утверждённый аватар и QR; QR читают сцены                                         | QR decode jsQR, cyber-scenes; защита SHA-256                                                         |
| artwork/logo/maseaaao.html + logo.css                                                         | build:artwork → Vite singlefile                        | .build-cache/artwork/logo/maseaaao.html                                                                   | предпросмотр композиции; не источник avatar-*.png генератора                      | build-contract / локальные ресурсы                                                                   |
| artwork/scenes/layout.json + obs-scene.css + build-cyber-scenes.mjs                           | --prepare → build:artwork → render:scenes              | .build-cache/artwork/scenes/_.html → artwork/scenes/rendered/_.webp                                       | OBS Images; размеры, alpha, safe zones и конечные пути сохраняются                | cyber-scenes, cyber-scene-corrections, fixture геометрии                                             |
| artwork/banners/{twitch,youtube}.html + banner.css/js                                         | build:artwork → render:banners                         | artwork/banners/rendered/{twitch,youtube}.jpeg                                                            | Twitch 1200×480, YouTube 2560×1440, safe area                                     | banner-dimensions, operational-pages                                                                 |
| artwork/twitch-description/{01-about,02-rules,03-donate,04-devices,05-specs}.html + panel.css | build:artwork → render:twitch-description              | artwork/twitch-description/rendered/те же имена.jpeg                                                      | пять панелей Twitch 320×64                                                        | operational-pages, banner-dimensions                                                                 |
| artwork/wallpapers/{desktop-4k,portrait-4k}.html + wallpaper.css                              | build:artwork → render:wallpapers                      | artwork/wallpapers/rendered/те же имена.png                                                               | 3840×2160 и 2160×3840                                                             | migration-contract, build-contract                                                                   |
| artwork/brand/{og,subscribe,background,icon}.html + brand.css + favicon-mask.svg              | build:artwork → brand:assets / render:favicon          | website/public: OG, subscribe, фон, favicon PNG/ICO, apple/android icons                                  | сайт, preview ссылок, manifest                                                    | banner-dimensions, build-contract                                                                    |
| packages/design/fonts/Unbounded.ttf                                                           | build:fonts, fonttools                                 | packages/design/fonts/unbounded-600.woff2                                                                 | все браузерные продукты; OFL и Unicode-покрытие                                   | build-contract, check-repository, render-image                                                       |
| apps/{stream-info,tuna-widget}/dist + лицензии                                                | tooling/package-release.py product-vX.Y.Z              | build/release/HTML + product-version.zip + notes.md                                                       | отдельная загрузка релиза; сайт сейчас не копирует HTML/ZIP                       | packaging byte equality, ZIP testzip                                                                 |

Дополнительные защищённые медиа: artwork/sounds/CENSOR_mac-quack.mp3 — исходный звук вне генераторов UI. Релизные архивы создаются отдельно и в baseline отсутствуют; выпуск/теги/публикация не выполняются. Обязательных локальных downloads в website/public сейчас нет: tools ссылаются на GitHub. Не добавлять скрытую зависимость build:website от старого файла релиза.

## Классификация каждого public-файла

Сайт владеет URL и копией в dist; генератор владеет только производным ресурсом. Защищённые оригиналы не пересобирать. В частности, QR сейчас технически создаётся render:logo, но для этой миграции утверждённый результат получает статус защищённого оригинала. Производные аватара разрешено переместить без перекодирования; сам утверждённый аватар и его существующие варианты сохранять побайтово. Исходный logo.png также защищён baseline.

| public/файл                          | Категория            | Владелец / источник                                                       |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------- |
| `.well-known/api-catalog`            | Защищённый оригинал  | website: ручной SEO/discovery/manifest документ                           |
| `_headers`                           | Защищённый оригинал  | website: ручной HTTP/cache policy                                         |
| `android-chrome-512x512.png`         | Результат генератора | artwork/brand/icon.html; brand:assets                                     |
| `apple-touch-icon-1024x1024.png`     | Результат генератора | artwork/brand/icon.html; brand:assets                                     |
| `apple-touch-icon.png`               | Результат генератора | artwork/brand/icon.html; brand:assets                                     |
| `assets/avatar-128.webp`             | Результат генератора | artwork/logo/logo.png; render:logo; производный утверждённого аватара     |
| `assets/avatar-192.webp`             | Результат генератора | artwork/logo/logo.png; render:logo; производный утверждённого аватара     |
| `assets/avatar-288.webp`             | Результат генератора | artwork/logo/logo.png; render:logo; производный утверждённого аватара     |
| `assets/avatar-64.webp`              | Результат генератора | artwork/logo/logo.png; render:logo; производный утверждённого аватара     |
| `assets/avatar-96.webp`              | Результат генератора | artwork/logo/logo.png; render:logo; производный утверждённого аватара     |
| `assets/maseaaao.tv.png`             | Защищённый QR        | Утверждённый PNG; исторический render:logo не запускать для миграции      |
| `assets/subscribe-512.png`           | Результат генератора | artwork/brand/subscribe.html; brand:assets                                |
| `assets/subscribe-background-ai.png` | Результат генератора | artwork/brand/background.html; brand:assets                               |
| `favicon-16x16.png`                  | Результат генератора | artwork/brand/icon.html + favicon-mask.svg; render:favicon / brand:assets |
| `favicon-32x32.png`                  | Результат генератора | artwork/brand/icon.html + favicon-mask.svg; render:favicon / brand:assets |
| `favicon-48x48.png`                  | Результат генератора | artwork/brand/icon.html + favicon-mask.svg; render:favicon / brand:assets |
| `favicon.ico`                        | Результат генератора | artwork/brand/icon.html + favicon-mask.svg; render:favicon / brand:assets |
| `manifest.webmanifest`               | Защищённый оригинал  | website: ручной SEO/discovery/manifest документ                           |
| `og-image.jpg`                       | Результат генератора | artwork/brand/og.html; brand:assets                                       |
| `robots.txt`                         | Защищённый оригинал  | website: ручной SEO/discovery/manifest документ                           |
| `sitemap.xml`                        | Защищённый оригинал  | website: ручной SEO/discovery/manifest документ                           |

## Маршрут ресурсов после миграции

Решение этапа 1, реализация переноса — вместе с генераторами и проверками на этапах 4/6:

1. Создать собственный output генераторов `artwork/brand/rendered/website/`, сохраняя относительные URL (`assets/avatar-96.webp`, `og-image.jpg` и т. д.). Генераторы logo/brand/favicon владеют непересекающимися файлами внутри него; не очищают общий каталог целиком.
2. Перенести туда перечисленные производные файлы побайтово. Удалить их прежние копии из public в том же изменении. Защищённые `_headers`, `.well-known/api-catalog`, manifest, robots, sitemap и `assets/maseaaao.tv.png` остаются в public. Генератор QR не получает права перезаписи этого оригинала.
3. Сборка сайта читает подготовленные результаты и public, копирует в корневой dist с прежними URL, проверяет отсутствие коллизий между public, результатами и страницами/bundles. Коллизия — ошибка, порядок копирования не определяет победителя.
4. Изменить check-repository и тесты parity одновременно: проверять каждого владельца и отсутствие устаревших дубликатов в public. Обновить ссылки исходных композиций, если они читают переносимые изображения. Сохранить QR-зависимость сцен от защищённого original.
5. Не запускать optimize:images на защищённых файлах: команда рекурсивно перезаписывает изображения. `full` также вызывает render:logo и требует изменения поведения перед использованием для миграции.

## Граф сборок и побочные записи

```text
Unbounded.ttf → build:fonts → WOFF2 + fonts.css/exports (на этапе 4: 400/600)
защищённые logo.png + QR + layout.json + design
  → scenes --prepare → .build-cache/artwork-source/scenes
  → build:artwork (включает подготовку scenes) → .build-cache/artwork
  → нужные render jobs → artwork/*/rendered + website image outputs
packages/design + packages/ui + локальные адаптеры
  → stream-info / tuna / widgets (отдельные outputs)
  → Storybook (будущий output; fixtures)
готовые website image outputs + website source + public → dist
готовый продукт + лицензии → release package (только явно, вне website build)
после outputs → npm run check → тесты результатов → diff --check
```

Сейчас build:all собирает tuna → stream-info → widgets → website, но не шрифты/изображения/Storybook. test:website неявно запускает build:artwork; источник повторных рендеров надо устранить на этапе 4/7. Генератор import пишет streamerbot-import.txt даже при UI-сборке; проверять побайтовую неизменность. build:widgets очищает только свой dist, website — корневой dist, singlefile — только свой app output; это проверяет source-isolation. Текущие render-команды каждый раз подготавливают весь artwork HTML, даже если выбран один вид изображений. Это подготовка, а не разрешение запускать все рендеры.

## Контракты поведения и границы переноса

### Сайт

`index.html → stream.js: summary/click/resize → локальные preference/status → Twitch SDK events → render()`. Состояния loading/online/offline/error, blocked playback; timeout определения статуса 12 секунд. READY сам по себе не доказывает online. SDK запускается один раз при ширине контейнера от 402 px (400 внутри границ); desktop от 768 px. При уменьшении ширины SDK повторно не создавать. Чат lazy, ручной выбор приоритетнее breakpoint; изменение статуса сохраняет iframe. Автозапуск muted, ошибка SDK возвращает исходный iframe. Сохранить все внешние ссылки из landing-upstream fixture, metadata/canonical/JSON-LD и контент без JS. Новая композиция может менять плотность и размещение, сохраняя эти функциональные ограничения.

`check.html → check.js → addPlayer/removePlayer → iframe`. Один iframe на платформу, повторное добавление идемпотентно, удаление действительно прекращает frame lifecycle. `tv=1` запускает оба; YouTube mute=0 только в TV, иначе 1; Twitch muted=true всегда; Twitch parent берётся из текущего hostname. На file:// Twitch embed невалиден, сайт проверять отдельно через HTTP. Веб-сайт не имеет localStorage настроек.

### Stream Info

`UI input/click → AppState/settings/forms → callAction → client.doAction → C# Execute → Custom.CodeEvent → requestResolvers → normalize → render`. Имя Action `STREAM INFO | API`, группа `STREAM INFO`, event `stream_info_api_response`, API 4. Передачу `payloadJson`/`requestId`, независимый transport acknowledgement и CodeEvent response сохранить. Команды: getState, searchTwitchCategories, updateTwitch, saveTemplates; пресеты PRESET | вызываются отдельно и используют applyPreset на C# стороне. C# кеш getState — 5 секунд, invalidate после записи, возвращает DeepClone.

Настройки localStorage `change-info-streamer-bot.settings.v1`: host=`127.0.0.1`, port=8080, endpoint=`/`, password=`, rememberPassword=false, twitchTemplate (defaults в templates.ts), lastSubtitle=`, twitchEnabled=true. Пароль записывается только при rememberPassword. Черновик template — sessionStorage `change-info-streamer-bot.template-draft.v1`, не обещать восстановление после закрытия вкладки. URL: наличие `demo` включает демонстрацию без подключения (не только значение 1).

Ответ Action ждёт 15000 ms. Refresh каждые 30000 ms только для видимого документа и при возвращении видимости; reconnect в клиенте включён, retries=-1. В закреплённом @streamerbot/client 2.0.1 задержка reconnect = min(30000, номер попытки × 1000) ms, connect timeout на повторе 10000 ms; не заменять собственным таймером при переносе. После пресета refresh через 700 ms. Поиск: минимум 2 символа, debounce 250 ms, одна активная операция + последняя ожидающая, generation защищает от устаревших/ABA ответов. Выдача порциями по 20; cursor, hasMore, partial, warnings, retry той же страницы, выбор по ID. Сохранять каретку/IME/focus при фоне, клавиатурное управление списком, focus trap/return/inert настроек. Разделить сохранение подключения, шаблона и метаданных; ошибки/частичный успех не очищают несохранённые поля и tag draft.

Валидация C#: title 1–140, до 10 тегов по 25 символов без пробелов; категория требует ID; до одного `%subtitle%` в шаблоне. Нельзя принять отключённый Twitch за доступный. Локальные формы не становятся сетевым API общего компонента.

### Tuna

`URL cfg → последовательный poll/request → parse(track) → process → текст/fade/artwork`. Poll запускается после завершения предыдущего запроса; интервал не заменять setInterval. API `http://localhost:port/`, JSON aliases title/song/track/name, artists/artist/album_artist/albumArtist, cover/artwork и варианты playing/status сохранить по parse/readPlaying.

| Параметр     | По умолчанию     | Диапазон  |
| ------------ | ---------------- | --------- |
| poll         | 1000 ms          | 100–60000 |
| start / show | 7000 ms          | 0–600000  |
| anim         | 1000 ms          | 0–60000   |
| idle         | 0                | 0–1       |
| art          | 700 ms           | 0–10000   |
| swap         | 420 ms           | 0–5000    |
| retry        | 900 ms           | 100–10000 |
| tries        | 3, округление    | 1–8       |
| timeout      | 4000 ms          | 500–30000 |
| fail         | 3, округление    | 1–20      |
| img          | 1                | 0.5–1.5   |
| ui           | 1                | 0.25–3    |
| port         | 1608, округление | 1–65535   |

Пустые/нечисловые значения возвращают defaults. Первый активный трек — start, смена/возобновление — show; скрытие после anim + duration. Ошибки до fail не вызывают мигания; pause/stop/пустой title скрывают виджет. token отменяет устаревшую обложку. Cache bust `_tuna` только локальным HTTP(S), не remote signed URL. Для неизменного URL при смене трека — дополнительное подтверждение в пределах tries. После неудачи новая серия не раньше max(5000,retry×3); освобождение старого слота через swap+80. Загрузка обложки через Image, поскольку локальный сервер может не иметь CORS для fetch. reduced-motion обнуляет anim/swap. Базовая композиция 420×82; responsive scale ограничен safe bounds 280×70. Сохранённых настроек нет.

### OBS и провайдеры

Соцполоса: статическая разметка, five icons, highlight CSS 15 s, смещения по 3 s, reduced-motion выключает анимацию. Клиентский JS сейчас нужен лишь для импорта CSS. Сохранить прозрачный внешний фон; размер и масштаб в сценах задаются layout.json.

Статистика: `connect/forget/Enter → normalize URL + credentials → OBS WebSocket op0 Hello/auth → op2 Identified → poll → op7 responses → rows/history`. По умолчанию ws://localhost:4455/. SHA-256 auth + AES-GCM, crypto.subtle и IndexedDB обязательны для текущего initialize. URL credential/fragment запрещены, небезопасный ws разрешён только для допустимого локального/private host. Без явного согласия не сохранять пароль. localStorage `easy-output-stats.credentials.v1`, IndexedDB `easy-output-stats-secure-storage` v1, store `crypto-keys`, key `credentials-aes-gcm-v1`; forget очищает оба вида хранения. Poll=500 ms, timeout=5000 ms, bitrate threshold=100 kbps, rejection=4 polls, FPS cutoff=40, encoder ratio=.85; outputs≤100, name≤1024, history≤200, message≤1000000. manual disconnect/close/unload чистят poll и pending. Автоматическое восстановление уже сохранённых credentials при initialize; автоматический retry после socket close не добавлять без отдельной причины.

Streamlabs: сохранить `{font_size}`, `{message_hide_delay}`, шаблон сообщения и placeholders `{from}`, `{messageId}`, `{color}`, `{message}` из chat-box.html; подстановка идёт после PostCSS ровно по одному маркеру. onLoad/DOMContentLoaded инициируют MutationObserver только один раз; host maseaaao и mention выделяются раздельно. При Vue-переносе cleanup observer/event listeners обязателен. DonationAlerts alerts/stats остаются CSS в поддерживаемом провайдером DOM; не пытаться внедрить Vue там, где поле принимает только CSS. Fonts/OFL встраиваются, события/анимации провайдера не заменяются.

### Artwork

layout.json содержит 12 финальных сцен: 2560×1440 горизонтальные, 1080×1920 вертикальные и cam-frame 600×341. Полный список ниже. Камера, игра, чат, музыка, alerts, donors, social и QR — safe zones, геометрию сверять с fixtures и SETUP.md. Утверждённый QR декодируется в https://maseaaao.tv; версия для сцен — этот original. В vertical-camera music/donors сейчас пересекаются: реестр фиксирует существующую раскладку, не исправляет её без разбора сценария. Часть горизонтальной camera geometry задана в генераторе, а не layout.json; на этапе 6 перенести туда, сохраняя результат. Статический контент artwork не должен требовать mounted.

## Аудит типов и жизненного цикла

- TwitchCategory/TwitchState/TemplateState совпадают с полями C# JSON; search также возвращает cursor/hasMore/partial/warnings, которые сейчас не имеют отдельного response type. ActionResponse.data Record<string,unknown> требует narrowing на каждой границе.
- В main.ts loadSettings использует assertions Partial/ключей; handleCodeEvent приводит root.args через unknown к ActionResponse и проверяет лишь requestId. Это существующие разрывы доверия, переносить их в Vue нельзя: нужны guards полного envelope/settings и типизированные command payload/results, включая частичный успех. Не менять C# schema ради удобства UI.
- JS Tuna/OBS нормализует фактические данные в runtime; при TS-переносе начинать с unknown, а не объявлять JSON валидным. Источник истины Tuna — текущие aliases/parser и fixtures; live HTTP-сервис не опрашивать ради миграции.
- Vue ещё не подключён: props/computed/watch пока отсутствуют. При переносе один владелец state/transport, derived значения через computed, props не теряют реактивность; не копировать .value вместо реактивной связи.
- Текущие таймеры/подписки принадлежат lifetime страницы. При SFC: unmount останавливает polling/debounce/pending, disconnect старого клиента, ResizeObserver/MutationObserver, listeners, animations и object URLs. Защита generation и IME сохраняется при повторном mount. DOM-полная перерисовка Stream Info заменяется реактивным UI с сохранением focus/caret.

## Ограничения автономной поставки

| Среда / API       | Контракт и обязательная проверка                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| file://           | Никаких соседних chunks/CSS/fonts; независимость доказывается копированием HTML в пустую папку. Origin локального файла нельзя считать HTTP origin.                                                                                                                                                              |
| Storage           | Проверить persistent browser profile, тот же абсолютный путь после перезапуска; при другом пути восстановление не гарантировано. sessionStorage имеет другой lifetime. Никаких живых пользовательских баз в fixtures.                                                                                            |
| WebSocket         | Реальный подставной WS endpoint с handshake/auth/CodeEvent и origin-политикой; JS mock клиента не проверяет browser transport. file origin может быть null; сервер должен явно допускать нужный сценарий.                                                                                                        |
| HTTP/CORS         | Tuna JSON fetch требует разрешения origin; Image-cover без CORS не доказывает доступность JSON. Проверять успешную и запрещённую политику тестового HTTP.                                                                                                                                                        |
| CSP               | output-stats: default-src none, nonce script/style, style/script attributes none, connect ws/wss, font/img data, Trusted Types для script и trusted-types none. Проверить Vue compiled runtime и DOM operations на готовом файле; не снимать политику молча. Остальные локальные HTML не имеют этой meta policy. |
| Сайт              | _headers сейчас задаёт кеш/discovery, не CSP. HTTP origin обязателен Twitch parent и iframe. CSP провайдера не выводится из локального fixture.                                                                                                                                                                  |
| Clipboard         | Проверить import copy success/failure; navigator.clipboard зависит от browser permissions/secure context, сохранить fallback textarea/select/execCommand(copy). Сейчас результат execCommand не проверяется: при переносе не объявлять копирование успешным после отказа обоих API.                              |
| OBS dock / source | Разные CEF-контексты/хранилища. Способ задания URL/file и версия CEF требуют отдельного подтверждения. Обычный Chromium не заменяет OBS-приёмку.                                                                                                                                                                 |
| Внешние ресурсы   | API, Twitch media/chat и динамическая cover допустимы как функциональные зависимости. Vue/runtime/fonts/CSS/CDN из сети — недопустимая зависимость автономного файла.                                                                                                                                            |

Пользователь подтвердил Windows 11 / Chrome; тестовой OBS сейчас нет, версия OBS/CEF не определена. На этой машине найдены Chrome и Node 22.22.3; OBS по стандартному /Applications/OBS.app не найден. Это ограничение этапа 2, не доказательство отсутствия OBS на целевом компьютере. По уточнению пользователя доступная работа продолжается, а проверки Windows/OBS вынесены в отдельные пустые чекбоксы плана; их нельзя считать выполненными.

## Полный список текущих конечных файлов

Размеры — фактические байты существующих файлов до изменения UI. Это инвентаризация, не budget и не benchmark запуска. Inline JS/CSS отдельно измерены в JSON; CSS включает base64 WOFF2, поэтому сумма файлов и embedded ресурсов не складывается. Бюджеты и startup timing утверждаются после образца и окончательной цепочки.

| Файл                                                              |   Байты |
| ----------------------------------------------------------------- | ------: |
| `apps/obs-widgets/dist/donors/donationalerts-stream-stats.css`    |  156712 |
| `apps/obs-widgets/dist/output-stats/index.html`                   |  182808 |
| `apps/obs-widgets/dist/social-strip/index.html`                   |  158359 |
| `apps/obs-widgets/dist/social-strip/transparent.png`              |      70 |
| `apps/obs-widgets/dist/sounds/health-warning.mp3`                 |   15810 |
| `apps/obs-widgets/dist/sounds/notif.mp3`                          |   25100 |
| `apps/obs-widgets/dist/streamlabs-chat/chat-box.css`              |  157625 |
| `apps/obs-widgets/dist/streamlabs-chat/chat-box.html`             |     421 |
| `apps/obs-widgets/dist/streamlabs-chat/chat-box.js`               |     934 |
| `apps/obs-widgets/dist/streamlabs-chat/donationalerts-alerts.css` |  156531 |
| `apps/stream-info/dist/change-info-streamer-bot.ru.html`          |  275912 |
| `apps/tuna-widget/dist/obs-tuna-widget.html`                      |  166198 |
| `apps/website/public/.well-known/api-catalog`                     |    1215 |
| `apps/website/public/_headers`                                    |    1207 |
| `apps/website/public/android-chrome-512x512.png`                  |  164962 |
| `apps/website/public/apple-touch-icon-1024x1024.png`              |  500008 |
| `apps/website/public/apple-touch-icon.png`                        |   21662 |
| `apps/website/public/assets/avatar-128.webp`                      |    1278 |
| `apps/website/public/assets/avatar-192.webp`                      |    1720 |
| `apps/website/public/assets/avatar-288.webp`                      |    2632 |
| `apps/website/public/assets/avatar-64.webp`                       |     744 |
| `apps/website/public/assets/avatar-96.webp`                       |    1012 |
| `apps/website/public/assets/maseaaao.tv.png`                      |   37760 |
| `apps/website/public/assets/subscribe-512.png`                    |   19380 |
| `apps/website/public/assets/subscribe-background-ai.png`          |    5243 |
| `apps/website/public/favicon-16x16.png`                           |     667 |
| `apps/website/public/favicon-32x32.png`                           |    1550 |
| `apps/website/public/favicon-48x48.png`                           |    2507 |
| `apps/website/public/favicon.ico`                                 |   15086 |
| `apps/website/public/manifest.webmanifest`                        |     518 |
| `apps/website/public/og-image.jpg`                                |   47163 |
| `apps/website/public/robots.txt`                                  |     121 |
| `apps/website/public/sitemap.xml`                                 |     293 |
| `artwork/banners/rendered/twitch.jpeg`                            |   31459 |
| `artwork/banners/rendered/youtube.jpeg`                           |   70222 |
| `artwork/logo/logo.png`                                           | 1178629 |
| `artwork/logo/rendered/avatar-1024.png`                           |  696676 |
| `artwork/logo/rendered/avatar-256.png`                            |   43266 |
| `artwork/logo/rendered/avatar-circle-1024.png`                    |  628759 |
| `artwork/logo/rendered/avatar-circle-256.png`                     |   41488 |
| `artwork/logo/rendered/avatar-circle-512.png`                     |  174437 |
| `artwork/logo/rendered/logo-circle.webp`                          |  401354 |
| `artwork/logo/rendered/maseaaao.webp`                             |  158932 |
| `artwork/scenes/rendered/00-blank-vertical.webp`                  |     128 |
| `artwork/scenes/rendered/00-blank.webp`                           |     198 |
| `artwork/scenes/rendered/01-start-vertical.webp`                  |    9546 |
| `artwork/scenes/rendered/01-start.webp`                           |   13034 |
| `artwork/scenes/rendered/02-pause-vertical.webp`                  |    9576 |
| `artwork/scenes/rendered/02-pause.webp`                           |   13350 |
| `artwork/scenes/rendered/04-camera-horizontal.webp`               |    3922 |
| `artwork/scenes/rendered/04-camera-vertical.webp`                 |    1232 |
| `artwork/scenes/rendered/99-end-vertical.webp`                    |    9226 |
| `artwork/scenes/rendered/99-end.webp`                             |   12234 |
| `artwork/scenes/rendered/background.webp`                         |     198 |
| `artwork/scenes/rendered/cam-frame.webp`                          |     552 |
| `artwork/twitch-description/rendered/01-about.jpeg`               |    4882 |
| `artwork/twitch-description/rendered/02-rules.jpeg`               |    5509 |
| `artwork/twitch-description/rendered/03-donate.jpeg`              |    4420 |
| `artwork/twitch-description/rendered/04-devices.jpeg`             |    5382 |
| `artwork/twitch-description/rendered/05-specs.jpeg`               |    6840 |
| `artwork/wallpapers/rendered/desktop-4k.png`                      |  135332 |
| `artwork/wallpapers/rendered/portrait-4k.png`                     |  147306 |
| `dist/.DS_Store`                                                  |    6148 |
| `dist/.well-known/api-catalog`                                    |    1215 |
| `dist/_headers`                                                   |    1207 |
| `dist/android-chrome-512x512.png`                                 |  164962 |
| `dist/apple-touch-icon-1024x1024.png`                             |  500008 |
| `dist/apple-touch-icon.png`                                       |   21662 |
| `dist/assets/.DS_Store`                                           |    6148 |
| `dist/assets/avatar-128.webp`                                     |    1278 |
| `dist/assets/avatar-192.webp`                                     |    1720 |
| `dist/assets/avatar-288.webp`                                     |    2632 |
| `dist/assets/avatar-64.webp`                                      |     744 |
| `dist/assets/avatar-96.webp`                                      |    1012 |
| `dist/assets/fonts/.DS_Store`                                     |    6148 |
| `dist/assets/maseaaao.tv.png`                                     |   37760 |
| `dist/assets/subscribe-512.png`                                   |   19380 |
| `dist/assets/subscribe-background-ai.png`                         |    5243 |
| `dist/bundles/check.html-CUK8QVQM.js`                             |    2232 |
| `dist/bundles/index.html-BsGYYkig.js`                             |    3701 |
| `dist/bundles/modulepreload-polyfill-B5Qt9EMX.js`                 |     711 |
| `dist/bundles/site-WbkkVUq-.css`                                  |   12695 |
| `dist/bundles/theme-CoqRwdox.css`                                 |     325 |
| `dist/bundles/unbounded-600-CPXfwbxF.woff2`                       |  111736 |
| `dist/check.html`                                                 |    2873 |
| `dist/docs.html`                                                  |    3178 |
| `dist/favicon-16x16.png`                                          |     667 |
| `dist/favicon-32x32.png`                                          |    1550 |
| `dist/favicon-48x48.png`                                          |    2507 |
| `dist/favicon.ico`                                                |   15086 |
| `dist/index.html`                                                 |   21671 |
| `dist/licenses/Unbounded-OFL.txt`                                 |    4391 |
| `dist/manifest.webmanifest`                                       |     518 |
| `dist/og-image.jpg`                                               |   47163 |
| `dist/robots.txt`                                                 |     121 |
| `dist/sitemap.xml`                                                |     293 |
| `dist/tools/index.html`                                           |    1246 |
| `dist/tools/stream-info.html`                                     |    1562 |
| `dist/tools/tuna-widget.html`                                     |    1437 |
| `packages/design/fonts/Unbounded.ttf`                             |  778272 |
| `packages/design/fonts/unbounded-600.woff2`                       |  111736 |
| `apps/stream-info/streamerbot-import.txt`                         |   21293 |
| `artwork/sounds/CENSOR_mac-quack.mp3`                             |   19154 |
