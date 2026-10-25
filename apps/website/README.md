# Сайт maseaaao.tv

Статический HTML + TypeScript, без runtime-фреймворка. Страницы: главная,
документация, Stream Checker и три страницы инструментов.

- Исходники: `src/`, публичные файлы: `public/`.
- Изображения сайта: `dist/artwork/brand/website`; сборка копирует их в `dist/website`.
- Аватар — один мастер-файл из `render:logo`; размеры и разметку `<img srcset sizes>`
  строит `@11ty/eleventy-img` на сборке сайта, и браузер сам выбирает файл под размер
  и плотность дисплея. Список ширин задаётся в `apps/website/vite.config.ts`.
- Общие стили: `@maseaaao/ui` и `@maseaaao/design` через workspace exports.

Из корня: `bun run build:website`. Конфигурация публикации — `wrangler.jsonc`.
Wrangler только загружает готовый `dist/`: build hooks отсутствуют,
продукты не копируются и не перекладываются.

## Публикация из GitHub Actions

**Release** один раз выполняет `full` (включая экспорт изображений), собирает
UI Gallery и проверяет продукты. Затем `prepare:cloudflare` добавляет в корень
готового `dist/` только `_redirects`, `.assetsignore` и общие `_headers`.
Браузерные каталоги архивируются с сохранением путей и скрытых файлов
(`.well-known`), без кеша, диагностики и Windows-продуктов. Artifact
`cloudflare-dist` хранится 30 дней, в том числе при `[skip release]`.

Однократная настройка:

1. В GitHub → Settings → Environments → `production` выберите
   **Selected branches and tags** и разрешите только ветку `main` (не тег).
   В **Environment secrets** добавьте
   `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers только для нужного аккаунта)
   и `CLOUDFLARE_ACCOUNT_ID`. Удалите одноимённые repository secrets и не
   предоставляйте этому репозиторию organization secrets с этими значениями:
   такие секреты доступны workflow других веток. Значения не добавляются в Git.
   Deploy использует окружение `production`; PR-проверкам секреты не нужны.
2. В Cloudflare отключите автоматические сборки/деплой **Workers Builds**
   для этого Worker. Git-интеграция клонирует исходники, а не artifact Actions;
   она не нужна для этой схемы и без готового `dist/` завершится ошибкой.

Публикация: Actions → **Deploy website** → Run workflow из `main` → `run_id`.
Это числовой ID успешного запуска **Release** (число после `/actions/runs/`
в его адресе), не номер релиза `vN`. Workflow проверяет успех и ветку `main`,
скачивает artifact выбранного запуска, берёт конфигурацию из того же коммита
и выполняет `bun run deploy:website`. Сборок и экспорта в Deploy нет.
Старые запуски без artifact, неуспешные и истёкшие сборки не подходят;
нужен новый успешный Release. Workflow не публикует GitHub Release.

## Локальная подготовка

В Linux/WSL2 `bun run build:cloudflare` с нуля экспортирует растры и собирает
веб-набор. Если уже выполнены `bun run full` и `bun run build:ui`, достаточно
`bun run prepare:cloudflare`: продукты не пересобираются.
`bun run deploy:website` публикует только готовые результаты и не запускает
ни подготовку, ни сборку. Проверка без публикации:
`bunx --bun wrangler deploy --dry-run`.

Маршруты задаются в корневом `_redirects`, внутренние rewrite сохраняют URL:

| Адрес           | Содержимое                                                   |
| --------------- | ------------------------------------------------------------ |
| `/`             | Лендинг и существующие страницы из `dist/website/`           |
| `/ui/`          | UI Gallery, включая её изображения                           |
| `/scenes/`      | Стартовая сцена; остальные — `/scenes/02-pause.html` и т. д. |
| `/stream-info/` | Док Stream Info                                              |
| `/tuna/`        | Музыкальный виджет                                           |
| `/widgets/`     | Соцполоса; CSS и шаблоны — в подпапках `/widgets/`           |

`.assetsignore` разрешает загрузку только браузерных продуктов и artwork;
кеш, диагностика, Companion, Windows-комплект, релизные архивы и импорт
Streamer.bot не публикуются. Неизвестные страницы возвращают 404, не лендинг.
Локальный просмотр уже подготовленного `dist/`:
`bunx wrangler dev`; публикацию она не выполняет. В установленной версии
Wrangler локальный dev-сервер требует Node.js: под Bun он возвращает 503
из-за несовместимости `fetch` с Miniflare. Сборка и dry-run работают под Bun.

Публикация HTML не заменяет локальные сервисы: Stream Info требует
Streamer.bot, Tuna — локальный HTTP-сервер. Доступ из HTTPS-страницы к ним
может ограничиваться браузером (mixed content, CORS, разрешение локальной сети);
локальные автономные сборки остаются доступны для OBS.

Главная ведёт на Twitch без iframe и autoplay. LIVE-индикатор отключён:
публичного авторизованного источника статуса нет. Stream Checker (`check.html`)
создаёт Twitch/YouTube iframe по запросу пользователя.


[Общие правила оформления](../../docs/design.md).
