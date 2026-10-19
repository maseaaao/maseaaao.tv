# UI Renewal — отдельный план исправлений и финального качества

**Дата:** 2026-10-19. **Статус:** план; ни один пункт ниже не считается выполненным.  
**База:** `main` @ `b0be32e`; отдельный неподключённый коммит `ee7a967` содержит черновую команду приёмки и **не** является выполненным этапом.  
**Связанные документы:** `docs/ui-renewal-plan.md` (исходная миграция — не изменять её чекбоксы в рамках этого плана), `docs/remaining-work.md` (живые установки/Companion), аудит от 2026-10-19 и его независимое ревью.

## Обязательные продуктовые решения

- **На главной странице полностью убрать встроенные Twitch-видео и чат.** Никаких iframe, Twitch Embed SDK, autoplay, кнопок раскрытия видео/чата и пустого медиаконтейнера. Сохранить обычную ссылку на Twitch и записи. Это **новое решение владельца**, поэтому старые баги размера player/chat, `::details-content`, двойного init и fallback закрываются *удалением функции*, а не её починкой.
- **Максимум — компактная LIVE-метка из `@maseaaao/ui/LiveStatusBadge.vue` рядом с профилем / основной Twitch-ссылкой.** Она появляется только при достоверном сигнале live. «Неизвестно» и сетевой сбой не равны «оффлайн»; не показывать ложный LIVE. Состояние offline не обязано показываться на лендинге.
- **Не удалять `check.html` по совпадению слова iframe:** это самостоятельный диагностический инструмент для ручного тестирования YouTube/Twitch. Отдельно решить его discoverability/noindex, но не переносить его плееры на главную.
- **OBS — Windows 11/CEF; рендеры и веб-проверки — Chrome/Chromium.** Тесты на Linux с mock-провайдерами не заменяют реальные платформенные проверки.
- **Рабочие OBS, Streamer.bot, Companion, токены, сцены, CSS в аккаунтах и публикация не меняются автоматически.** Для них нужен отдельный dry-run/backup/явный шаг установки.
- **Не расширять архитектуру ради абстракций.** Предпочитать существующие пакеты/инструменты, не вводить `any`, необоснованные assertions, дублирующие state-management системы, дополнительный bundler и сторонние live-status виджеты.

## Правила выполнения

Каждый **этап** ниже — один самостоятельный коммит, содержащий законченные изменения этого этапа и его тесты. Каждая реально выполненная часть — отдельный отмеченный `[x]` чекбокс **с проверкой**. При незапущенном тесте оставлять `[ ]` и записывать среду/блокер. Изменение плана само по себе не закрывает задачи реализации. Не изменять `docs/ui-renewal-plan.md`, чтобы планы оставались независимыми. Порядок этапов — по зависимостям; необязательные улучшения не блокируют функциональные фиксы.

Маркировка: **P1** — подтверждённый или условно воспроизводимый сбой состояния/данных, исправить до выпуска; **P2** — корректность/UX/архитектура; **QA gate** — обязательная проверка выпуска, не всегда баг; **P3** — улучшение по измеренной необходимости. Для каждого замечания сохранять: исходник/строки, сценарий, доказанность (код/mock/реальная платформа), тип (регрессия/старый долг/новая функция), приоритет и тест.

## Этап 0. Воспроизводимая исходная точка и трассировка — QA gate

- [ ] Зафиксировать HEAD, версии Node/npm/Python/.NET, Chromium, OBS/CEF, Streamer.bot/Companion; собрать список исходных и генерируемых файлов; проверить, что detached `ee7a967` не входит в `main`.
- [ ] По истории/документированным baseline сравнить поведение **до/после** UI-перехода: контракт URLs, persisted keys, WebSocket/action IDs, поставляемые HTML, provider placeholders, scene transforms. Не принимать наличие старой особенности за регрессию.
- [ ] Для каждого подтверждённого замечания добавить минимальный воспроизводимый fixture либо задокументировать, почему оно пока требует Windows/OBS/провайдера.
- [ ] Зафиксировать эталонные screenshots **собранных** экранов и WEBP/JPEG; отдельно проверить, какие источники доступны только в работающем OBS. Не выдумывать «успешный baseline».
- [ ] Убедиться, что существующие тесты выполняются после чистого `npm ci`; сохранить результаты/версии и список незапущенных проверок.

**Готово, когда:** есть проверяемая матрица «старое ↔ новое», доступные исходные measurements и список ограничений среды. **Коммит:** `test(audit): pin regression baseline and traceability`.

## Этап 1. Упростить главную: Twitch только ссылкой — продукт/дизайн

**Файлы:** `apps/website/src/components/HomePage.vue`, `apps/website/src/index.html`, `apps/website/src/assets/stream.js`, `apps/website/src/assets/site.css`, затронутые tests/stories/docs.

- [x] Удалить `stream-layout`, `stream-content`, оба iframe, `details`, статусы loading/offline/error, плейбек, lazy chat, fallback и относящуюся только к ним CSS-сетку.
- [x] Удалить Twitch Embed SDK, `ResizeObserver`, двойной iframe-init, script `stream.js` и asset entry, **если** они больше не нужны LIVE-индикатору. Не оставлять мёртвые стили/JS или пустое место на странице.
- [x] Сохранить единственный осмысленный главный CTA на Twitch, ссылки на записи и контакты; устранить дубли/неудачные подписи и обновить композицию без медиасекции. Сохранить корректную семантику и видимую клавиатурную навигацию.
- [x] Переписать Storybook/тесты лендинга: отсутствие embedded video/chat и запросов к `player.twitch.tv`/`twitch.tv/embed`/`js/embed/v1.js`; доступные ссылки; 320/390/540/768/900/1024/1440/1920 px, 200% zoom, reduced-motion/no-JS.
- [ ] Проверить метаданные, структурированные данные и отсутствие влияния на `check.html`, `tools/*`, `docs.html`.
- [ ] Получить и принять реальные Chrome screenshots нового главного экрана и состояний hover/focus/keyboard. Дизайн-проверку без просмотра скриншотов не считать выполненной.

**Дополнительная проверка [ ]:** выполнить новые browser tests в Chrome/Chromium и визуально проверить screenshots. В этой среде они не запускались.

**Готово, когда:** главная никогда не монтирует Twitch media/chat и не содержит пустой блок трансляции; `check.html` сохранён. **Коммит:** `refactor(website): remove Twitch embeds and simplify landing`.

## Этап 2. Реальный LIVE-индикатор без iframe — условная функциональность

**Выбор реализации:** прежде проверить действующий hosting. Сейчас `wrangler.jsonc` публикует **статические assets**; готового приватного HTTP API статуса в проекте нет. Рекомендуемый механизм при наличии учётных данных — минимальный same-origin Cloudflare Worker route `GET /api/live` → Twitch Helix `GET /helix/streams?user_login=maseaaao` с **app access token**, server-side секретами и коротким кешированием. Не присылать Twitch token/secret в клиент и не читать живой Streamer.bot с публичного сайта. Cloudflare Worker вводить **только** ради проверенного требования LIVE, а не как обязательную зависимость остальных страниц.

- [ ] Проверить конфигурацию и доступность Cloudflare/Twitch Developer App; зафиксировать решение: (а) безопасный backend для LIVE, либо (б) полностью статическая страница **без бейджа**, если секреты/развёртывание не доступны. Не имитировать статус HTML-хаком, scraping или client OAuth.
- [ ] Если выбран backend: сделать `GET /api/live` с закрытыми Twitch Client Secret/access token, обработкой 401/429/5xx/timeouts, TTL кеша порядка 30–60 сек и ответом `live | offline | unknown` (типизированный минимальный JSON). Добавить тесты edge cases и секретов. Не хранить пользовательский OAuth без необходимости.
- [ ] Подключить только `LiveStatusBadge` на главной; по умолчанию **скрыт**, показывается при подтверждённом live, unknown/error не превращать в offline; опрос только при необходимости, с visibility/abort и без гонок старых ответов.
- [ ] Проверить API ошибку/первую загрузку/переход offline→live→offline, disabled JavaScript, доступность статуса с текстом (не только цветом) и отсутствие layout shift.
- [ ] Подтвердить реальный LIVE в production/safe test environment без запуска эфира ради теста; если live-проверка невозможна, оставить соответствующий чекбокс открытым.

**Готово, когда:** либо достоверный и безопасный LIVE, либо сознательно **никакого статуса** и никакого нового runtime-backend. **Коммит:** `feat(website): add verified live-only status` **либо** `docs(website): record no-live-backend decision`. **Зависимость:** этап 1. **Примечание:** статус является опцией, отсутствие backend не блокирует релиз сайта без iframe.

## Этап 3. Stream Info: данные, сохранение и восстановление — P1/P2

**Файлы:** `apps/stream-info/src/composables/useStreamInfo.ts`, соответствующие компоненты/tests и при необходимости C# action без изменения стабильных API/ID.

- [ ] Сначала добавить падающие тесты: `persistSubtitle` backend reject/timeout/disconnect/late response/reopen; подтверждённое/неопределённое сохранение и сохранение черновика без ложного success.
- [ ] Разделить editable draft, last-confirmed server state и persisted local value; фиксировать подтверждённое значение только после ACK, не терять текст при partial success/reconnect; повторный запрос не должен молча перетирать более свежий draft.
- [ ] Сравнивать поля семантически: не отправлять `saveTemplates` при изменении только title/category/tags и не блокировать unrelated Twitch update ошибкой неизменённого subtitle. Проверить частичное применение.
- [ ] Различать network/auth/action-missing/action-outdated errors; при пароле в storage не считать любую транспортную ошибку auth-проблемой. Проверить восстановление после неверного пароля.
- [ ] Не переподключать WebSocket при сохранении настроек, если host/port/endpoint/credentials не изменились; проверить конфигурацию `rememberPassword` отдельно от транспорта.
- [ ] Добавить детерминированные тесты повторного save, stale request generation, presets, category pagination, IME, status notices и UI после reconnect. Стабильные имена Actions, IDs, persistent keys и локальные флаги сохранить.

**Готово, когда:** подтверждённое backend и local состояние не расходятся без обозначения ошибки, чужие изменения не блокируются лишними write, нет ложной авторизации. **Коммит:** `fix(stream-info): reconcile persisted state and transport lifecycle`.

## Этап 4. OBS Output Stats: безопасные credentials и race-free lifecycle — P1

**Файл:** `apps/obs-widgets/src/output-stats/main.js`, Browser Source tests.

- [ ] Сначала воспроизвести deferred-promise сценарии: параллельные open/dock, save→forget, reconnect при сохранении, startup restore→manual connect, закрытие socket, временный отказ IndexedDB, повреждённый ciphertext.
- [ ] Перестать удалять сохранённый ciphertext при любой ошибке `loadCredentials`: отличать повреждение записи/невозможность расшифровки от временной недоступности storage; предлагать ручной reset с явным действием, не удалять молча.
- [ ] Исключить гонку `getOrCreateCredentialKey`: координация создания ключа и записи ciphertext на одном origin/IDB, с повторной проверкой существующего ключа; проверить два одновременно открытых экземпляра.
- [ ] Оградить асинхронные save/load/forget и `handleIdentified` по attempt/generation; устаревшее соединение не может переписать новый статус/credentials. Очистить пароль из памяти там, где он больше не нужен.
- [ ] Проверить режим без secure storage: WebSocket может работать с вводом credentials вручную, если сам транспорт доступен; надёжно отключить только remember/autorestore, не подменять реальные ошибки красивой заглушкой. Проверить CSP.
- [ ] Добавить доступную диагностику connection state и ручное восстановление; измерить polling 500 ms/таймауты при нескольких outputs, без произвольной смены частоты до измерений.

**Готово, когда:** нет потери credentials от временной ошибки, двух разных активных ключей или позднего callback; тесты проходят с mock WebSocket/IDB и на установленном OBS позднее. **Коммит:** `fix(obs-stats): make credential lifecycle recoverable`.

## Этап 5. Provider skins: Chat/DonationAlerts, реальные данные — P2

- [ ] Добавить падающие fixtures на сообщение пользователя, ник которого **содержит** `maseaaao`, но текст его не упоминает; различать author и **message-only**; вложенные элементы, badges и emotes не должны давать false mention.
- [ ] Исправить `apps/obs-widgets/src/streamlabs-chat/chat-box.js`: host по точному `data-from`, mention по содержимому `.message`, защищённому от посторонних metadata; проверить MutationObserver для динамического добавления.
- [ ] Проверить generated CSS/provider placeholders после PostCSS; не вставлять `{font_size}`/`{message_hide_delay}` в локальный OBS CSS без подстановки провайдера.
- [ ] Проверить clipping донатеров и алертов по фактическим зонам `layout.json`: кириллица, emoji/ZWJ, длинный ник, многострочный текст, emotes/badges, fade timings и transparent alpha. Зафиксировать явную политику сокращения, а не скрывать существенные данные случайным ellipsis.
- [ ] Провести provider preview на **реальном** DOM/CSP Streamlabs/DonationAlerts без живых донатов/сообщений; обнаруженные несовместимости вынести в отдельные чекбоксы и regression fixtures.

**Готово, когда:** нет ложных упоминаний и визуально неприемлемой обрезки; provider lifecycle не нарушен. **Коммит:** `fix(providers): align chat and alert rendering with provider contracts`.

## Этап 6. Tuna и эксплуатационная производительность — P2/P3

- [ ] Добавить opt-in debug diagnostics для HTTP/Tuna/обложек (port/CORS/timeouts), без ошибок/секретов в live overlay; сохранить прежний normal-mode appearance.
- [ ] Удалить невидимые glow image nodes **только если** новые контрактные тесты подтверждают отсутствие изменения загрузки обложек/переходов; иначе оставить и записать как принятое ограничение.
- [ ] Прогнать pause→resume, смену двух треков, overtake при медленной загрузке, reconnect Tuna server, 404 cover, offline recovery, варианты query params и source resizing.
- [ ] Измерить baseline CPU/memory/GC/Network в Chrome и позже OBS при нескольких одновременно активных Browser Sources. Оптимизировать polling/updates только при измеренном отклонении, не ухудшать 1% low OBS без оснований.

**Готово, когда:** нормальный overlay функционально эквивалентен исходному, отказ диагностируем, ресурсы не накапливаются. **Коммит:** `test(tuna): harden media lifecycle and diagnostics`.

## Этап 7. Полноценный дизайн-ревью artwork и всех экранов — QA/design gate

- [ ] Проверить конечные screenshots сайта, Stream Info, OBS Output Stats, social-strip, Tuna, Streamlabs/DonationAlerts, всех 12 сцен, баннеров, панелей Twitch, OG/subscribe, favicon/avatar и 4K обоев. **Не** подменять дизайн-ревью чтением CSS.
- [ ] Для Chrome/Chromium закрепить snapshots на 320/390/540/768/900/1024/1440/1920 px, 200% zoom, focus/keyboard, reduced motion, forced colors (где применимо); проверить контраст, overflow, читаемость, визуальную иерархию и одинаковые tokens.
- [ ] Для OBS-композиций проверить изображения **вместе с реальными размерами и transform источников**, alpha, corners, QR, safe-zone, overlays и масштабирование 2560×1440/1080×1920. Слои не менять вслепую.
- [ ] Разобрать намеренное пересечение `vertical-camera.music` и `vertical-camera.donors`: зафиксировать правило взаимной исключительности **либо** согласовать новое размещение. Это существовавший layout, не автоматически регрессия.
- [ ] Принять визуальные baseline человеком перед включением жёстких pixel tests; не менять защищённый logo/QR автоматически и не изобретать новый бренд.
- [ ] Для найденных визуальных проблем — скриншот «до/после», минимальное изменение исходника, рендер и регрессия.

**Готово, когда:** композиции и масштабирование одобрены по реальным артефактам, а все известные нарушения приведены к исправлению/зафиксированному решению. **Коммит:** `fix(design): close approved visual regressions`.

## Этап 8. Точечный архитектурный и документационный долг — P2/P3

- [ ] Привести `packages/ui`/design docs, `LiveStatusBadge` comments и `docs/build-toolchain.md` в соответствие с реальными workspace exports и потребителями; не извлекать компонент до появления второго подтверждённого контракта.
- [ ] Проверить `CategorySearch.vue` ARIA combobox/listbox с screen reader + keyboard/IME; убрать двойной Tab flow при подтверждённом неудобстве, сохраняя семантику опций.
- [ ] Убрать ненужный inline `onerror` аватара при эквивалентном fallback и проверить строгий CSP/no-JS; аудит других HTML inline event handlers.
- [ ] Почистить устаревшие `_headers` пути (`assets/stream.js`, theme/site/brand), sitemap/lastmod и docs ссылки; проверить `wrangler` deploy paths и кеш immutable vs revalidate.
- [ ] Исправить `artwork/scenes/SETUP.md` (вес Unbounded и актуальный `.build-cache`), инструкции Python >=3.11, README продуктов, AGENTS; связать план с `docs/remaining-work.md` без переноса статуса оттуда в этот файл.
- [ ] Проверить `npm audit` заново и triage dev advisory `braces` (7 high в предыдущем отчёте); без игнорирования предупреждений или форсирования небезопасных override.

**Готово, когда:** документация совпадает с поставляемыми файлами, а рефакторинг не меняет без тестов старый API. **Коммит:** `chore(architecture): align contracts, metadata and docs`.

## Этап 9. Полный детерминированный build/CI/visual pipeline — QA gate

- [ ] Проверить и исправить черновой `ee7a967` **до** включения: `git diff --check` проверяет whitespace, но не stale/binary generated resources. Перенести подходящие части в актуальную ветку отдельно, с учётом нового лендинга без Twitch JS.
- [ ] Построить единый граф: `check:source` → шрифты/аватар → artwork SSR → scenes+brand+banners+panels+wallpapers → ui/storybook+standalone apps → website → `check` → тесты → проверка outputs. Включить полный граф в CI с фиксированными версиями environment.
- [ ] Проверять **все** управляемые tracked outputs через `git diff --exit-code -- <paths>` + обнаружение новых/untracked/stale outputs и manifest/hashes. Отдельно учитывать допустимые различия растров Windows/Linux — baseline привязать к зафиксированному Chrome/Chromium/OS, не маскировать шум отключением проверки.
- [ ] Устранить зависимость optional screenshot test от чужого `../Streamer.bot/backup/.../reserve.py` — isolated checkout не должен требовать локальных бэкапов. Разделить генерацию images и утверждённые baseline.
- [ ] Запустить `npm ci`, `npm run check:source`, финальные сборки, `npm run check`, `npm run test:ui`, `npm run test:ui-probe`, `npm run test:static`, `npm run test:checks`, полный `npm test`, C#/.NET 8, Windows Companion packager и проверку архива там, где доступны зависимости. Не отмечать неисполненное пройденным.
- [ ] Проверить byte-size budgets, no duplicated Vue/browser compiler, no remote UI assets for file:// HTML, собственность output directories, отсутствие изменения исходников и устойчивость чистого checkout.
- [ ] Сформировать build provenance: hash каждого артефакта, tool versions, статус тестов, связь commit↔release; убедиться, что CI проверил **именно** публикуемый commit.

**Готово, когда:** обязательная последовательность воспроизводима и CI ломается на устаревшем бинарнике, недостающем файле, regressions и неправильной упаковке. **Коммит:** `ci: verify full UI artifact graph and reproducibility`.

## Этап 10. Целевая интеграционная приёмка и выпуск — release gate

- [ ] Windows 11 OBS/CEF: реальные загруженные standalone HTML из `file://`, secure context/crypto/IndexedDB, replay/reopen, WebSocket, 2 окна, screen scaling, transparency и request lifecycle. Записать версии OBS и CEF.
- [ ] Изолированный Streamer.bot 1.0.x: импорт C# с сохранением IDs/API version, mocked Twitch Helix, reconnect, network/auth errors, presetted globals; не запускать работающие Actions и эфир ради теста.
- [ ] Streamlabs/DonationAlerts: provider preview + OBS через существующие URL; проверить placeholders/DOM/animations/CSP, font faces, emotes, alerts и длинные сообщения без реальных донатов.
- [ ] Сравнить `sync:local` dry-run destinations с рабочими OBS IDs/source paths и документировать список отличий; только после **отдельного подтверждения** — backup/apply/verify/rollback. Проверять installed hash, а не только `dist`.
- [ ] Незакрытые Companion updates и Action `Scene | 5. 🛑STOP` оставить в `docs/remaining-work.md` как смежные операционные задачи; не устранять и не отключать автоматически в рамках UI.
- [ ] Написать финальный отчёт с таблицей: исходник → build artifact → CI → installed version → platform validation → ограничения; не объявлять сайт опубликованным из-за push/коммита.
- [ ] Отдельно согласовать публикацию или обновление рабочего OBS/провайдеров и только после этого завершить release gate.

**Готово, когда:** реальные целевые условия подтверждены либо обозначены явными блокерами; никакая конфигурация эфира не изменена без отдельного решения. **Коммит:** `docs(release): record verified cross-platform acceptance`.

## Что явно не является обязательным фиксом

- Нет смысла чинить плеер/чат главной после принятого решения их удалить. Их прежние P1-02/03/04/05 + часть a11y просто выводятся из эксплуатации.
- Перекрытие music/donors — известное сохранённое поведение; решение только по сценарию их одновременного показа.
- Отсутствие автоматического обновления OBS/Streamer.bot — **положительная защита**, а не defect. Важна процедура обновления с проверкой.
- 1200 строк composable не требуют немедленного дробления: разделять по границам ответственности при наличии тестов, а не по размеру файла.
- Ненужные зависимости, media embeds, UI-индикаторы при недостоверном backend и новые API без подтверждённой пользы запрещены этим планом.

## Общий критерий завершения

Все обязательные задачи P1/P2 и QA gates или выполнены и отмечены доказательствами, или исключены с объяснением и согласованным риском. Линтеры/моки/Storybook сами по себе не подтверждают Chrome/Windows/OBS/провайдеров. Каждый этап — отдельный коммит, без автоматического push, релиза или изменения установленных рабочих ресурсов.
