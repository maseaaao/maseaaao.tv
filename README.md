# maseaaao.tv

Сайт, оформление OBS и инструменты стрима. Один релиз `vX.Y.Z`, один ZIP
для ручной установки в Windows. OBS, Streamer.bot и Companion в комплект не входят.

## Продукты

| Каталог                                                    | Назначение                                                |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [apps/website](apps/website/README.md)                     | Статический сайт на HTML+TS; публикация в корневом `dist` |
| [apps/stream-info](apps/stream-info/README.md)             | Русский док Twitch, C# API и импорт Streamer.bot          |
| [apps/tuna-widget](apps/tuna-widget/README.md)             | Автономный музыкальный виджет                             |
| [apps/obs-widgets](apps/obs-widgets/README.md)             | Соцполоса, чат и CSS провайдеров                          |
| [integrations/companion](integrations/companion/README.md) | Модули и запускатель Companion                            |
| [integrations/streamerbot](integrations/README.md)         | C# Actions для Streamer.bot                              |
| [artwork](artwork/README.md)                              | Логотип, сцены, баннеры, панели и обои                    |
| `packages`                                                 | Общие дизайн-токены, UI и конфигурации сборки             |
| `tooling`                                                  | Сборка, проверки, генераторы и установка                  |

## Разработка

Среда разработки и CI — Linux/WSL2, Bun из `.bun-version`.
Для полной проверки нужны .NET SDK 8, системный `tar` и Chromium.
В WSL используйте Linux-версии Bun и зависимостей, не Windows `node_modules`.

```bash
bun install --frozen-lockfile
bun run browser:install --with-deps
bun run build:all
bun run check
bun run test
```

| Команда | Назначение |
| --- | --- |
| `build` | Только сайт → корневой `dist` |
| `build:all` | Приложения, HTML/CSS artwork и диагностика; без экспорта растров и TGZ |
| `check:source` | Biome, Knip, типы и структура исходников; сборки не нужны |
| `check` | Проверки исходников и готовых результатов |
| `test` | `build:all`, затем тесты репозитория, Stream Info, Companion и локальных инструментов |
| `test:checks` | Те же тесты без предварительной сборки |
| `verify:ui-renewal` | CI-проверка с экспортом и сверкой изображений |
| `verify:companion` | Сборка, упаковка и проверка модулей Companion |

Команды таблицы запускаются через `bun run <команда>`. `bun test <файл>` —
отдельные JS/TS-тесты; DOM-тесты Stream Info запускайте из `apps/stream-info`.
Браузерные корневые тесты могут пересобирать общий `dist`: не запускайте их параллельно.
Для своего Chromium задайте `CHROME_BIN`. CI использует закреплённый образ Playwright
из `.github/workflows/verify.yml`.

Меняйте исходники, затем пересобирайте результаты. `bun run format` форматирует код,
`bun run check:fix` применяет исправления Biome. Отдельный Node.js не нужен;
Companion использует собственный комплектный Node.

`bun run deploy:website` собирает и публикует сайт в Cloudflare через `wrangler.jsonc`.
Это отдельная операция, не проверка и не часть выпуска ZIP.

## Установка и оформление

- [Windows: установка, обновление, откат и выпуск релиза](docs/windows-releases.md).
- [Подключение OBS, Streamer.bot и Companion из исходников](docs/local-installation.md).
- [Дизайн, движение и генерация оформления](docs/design.md).
- [Правила изменения репозитория](AGENTS.md).

Рабочие настройки, базы, токены и резервные копии приложений не входят в Git.
Сборка не устанавливает модули, не переключает сцены и не публикует сайт.
Сохраняйте лицензии проекта, стороннего кода и Unbounded, включая встроенные уведомления.

## Общие документы

- [История изменений](CHANGELOG.md).
- [Участие в проекте](CONTRIBUTING.md).
- [Кодекс поведения](CODE_OF_CONDUCT.md).
- [Политика безопасности](SECURITY.md).
- [Лицензия MIT](LICENSE) — собственный код проекта. Для стороннего кода и ресурсов действуют сохранённые рядом лицензии и уведомления, включая [DonationAlerts](integrations/streamerbot/donationalerts/LICENSE) и [Unbounded](packages/design/licenses/Unbounded-OFL.txt).


