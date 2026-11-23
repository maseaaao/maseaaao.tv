# Ресурсы OBS

Соцполоса, шаблон чата Streamlabs и CSS DonationAlerts для alerts и донатеров.

```bash
bun run build:widgets
```

Команда выполняется из корня. Исходники — `src/`, готовые ресурсы — в корневом `dist/obs-widgets/`:

| Ресурс                                                         | Подключение                       |
| -------------------------------------------------------------- | --------------------------------- |
| `social-strip/index.html`                                      | Локальный браузерный источник OBS |
| `site-link/index.html`                                         | Локальный браузерный источник OBS |
| `streamlabs-chat/chat-box.html`, `chat-box.css`, `chat-box.js` | Поля HTML, CSS и JS в Streamlabs  |
| `streamlabs-chat/donationalerts-alerts.css`                    | CSS оповещений DonationAlerts     |
| `donors/donationalerts-stream-stats.css`                       | CSS статистики DonationAlerts     |

`site-link` — только адрес `maseaaao.tv`: без иконок соцсетей и счётчика цели.
Размеры источника те же, что у соцполосы; фон прозрачный, плашка светлая.

Соцполоса автономна и во всех сценах выглядит одинаково: без скруглений.
Высота горизонтальной полосы уменьшена, размер текста сохранён.
Иконки соцсетей статичны: постоянная полоса не должна двигаться в кадре.
Анимация донатеров включена для эфира независимо
от настройки анимаций Windows.
Для разных ширин нужны отдельные browser inputs с нативными viewport:
640×55 для горизонтальных статусных сцен, 480×36 для горизонтального gameplay,
720×88 для вертикальных статусных сцен, 1080×88 для вертикальных камеры и
gameplay. Для горизонтальной камеры нужен отдельный вход 1280×65 без масштаба:
апскейл 1080×55 до 1280×65.2 мылит текст и иконки. OBS поддерживает browser
sources до 4096 px, ограничение в 1080 px — миф.
Каждый input открывает локальный файл той же страницы
`file:///C:/path/to/obs-widgets/social-strip/index.html` (поле локального файла).
Существующий общий input 1080×64 не меняйте: его растяжение не заменяет
отдельные источники. Подробности — в
[карте и подключении сцен](../../artwork/scenes/SETUP.md).

Браузерные тесты: `bun run --filter @maseaaao/obs-widgets test`. Для системного
Chromium задайте `CHROME_BIN`; тесты не подключаются к OBS и провайдерам.
CSS провайдеров содержит встроенные шрифт и лицензию.
Провайдер управляет данными, сменой и удалением сообщений. Его placeholders,
обработчики и задержки нужно сохранять. Шаблон CSS Streamlabs нельзя напрямую
вставлять в OBS override: `prepareObsChatCss` из
`tooling/local/obs-provider-css.ts` адаптирует его с сохранением размера текста.

Сборка не обновляет OBS и аккаунты провайдеров. Для копирования локальных
ресурсов и отдельной установки provider CSS см. [подключение](../../docs/local-installation.md).

## Страница для хостов без Custom CSS

DonationAlerts не отдаёт CORS-заголовки, а стили в чужой iframe не попадают.
Для TikTok LIVE Studio и похожих хостов страница собирается локально:

```bash
bun run build:widgets
bun tooling/local/build-donors-html.ts
```

Ссылку на виджет одной строкой положите в `.runtime/da-donors.url` — каталог
игнорируется git. Скрипт пишет `.runtime/da-donors/stream-stats.html` с собранным
CSS и текущими донатами. `--watch` обновляет `data.js` каждые 15 секунд, страница
подхватывает его без перезапуска. Если Link-источник TikTok не принимает `file://`,
запустите с `--serve` и укажите `http://127.0.0.1:7411/stream-stats.html`.

Живая страница отдаётся отдельным Worker-ом `maseaaao-donors` на workers.dev,
а `https://maseaaao.tv/live/da/top` отвечает редиректом на него. Это обходит
ограничение Cloudflare: запросы из зоны `maseaaao.tv` к DonationAlerts падают
с 525, а с workers.dev те же запросы проходят.

```bash
bun run build:widgets
bun run build:website
bun run prepare:cloudflare
bunx wrangler secret put DA_WIDGET_URL --config wrangler.donors.jsonc
bun run deploy:website
```

`deploy:website` сначала обновляет donor Worker, затем сайт. Токен живёт только
в секрете donor Worker и не попадает в HTML или репозиторий. Страница закрыта
от индексации, но адрес публичный: данные видны всем, кто его откроет.

[Общие правила оформления](../../docs/design.md).

## Цель на фолловеров

`social-strip/index.html` принимает query-параметры:

- `?goal=1` — счётчик и заливка прогресса в полосе (игровые и камерные источники);
- `?layout=goal` — блок цели для статусных источников (560×90 / 720×90);
- `?action=Creator Goal` — имя действия Streamer.bot (по умолчанию);
- `?ws=ws://127.0.0.1:8080` — адрес WebSocket Streamer.bot;
- `?demo=1` — 18/20 без Streamer.bot для проверки вёрстки.

Текущее подключение использует WebSocket Streamer.bot без аутентификации;
подключение с аутентификацией не поддерживается.

Статусные полосы остаются без счётчика: на статусе цель показывает блок.
Полоса квадратная, рамка 1 px; прогресс — заливка панели, а не линия по низу.
