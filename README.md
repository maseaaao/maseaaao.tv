# maseaaao.tv

Сайт, оформление OBS и инструменты стрима. Один репозиторий, один релиз
`vX.Y.Z`, один ZIP с папками продуктов для ручной установки.

## Продукты

| Каталог                                                    | Назначение                                                |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [apps/website](apps/website/README.md)                     | Статический сайт на HTML+TS; публикация в корневом `dist` |
| [apps/stream-info](apps/stream-info/README.md)             | Русский док Twitch, C# API и импорт Streamer.bot          |
| [apps/tuna-widget](apps/tuna-widget/README.md)             | Автономный музыкальный виджет                             |
| [apps/obs-widgets](apps/obs-widgets/README.md)             | Соцполоса, чат и CSS провайдеров                   |
| [integrations/companion](integrations/companion/README.md) | Модули и запускатель Companion                            |
| `integrations/streamerbot`                                 | Интеграции Streamer.bot                                   |
| `artwork`                                                  | Логотип, сцены, баннеры, панели и обои                    |
| `packages`                                                 | Общие дизайн-токены, UI и конфигурации сборки             |
| `tooling`                                                  | Сборка, проверки, генераторы и установка                  |

## Разработка

Работать в Linux/WSL2 с Linux-версиями Bun и Node из `.bun-version` и
`.node-version`. Нужны .NET SDK 8 и системный `tar`; для видео сцен — FFmpeg с
libvpx-vp9. Windows-приложения OBS, Streamer.bot и Companion остаются в Windows.
Не использовать Windows `node_modules` или `node.exe` в WSL.

```bash
bun install --frozen-lockfile
bun run browser:install --with-deps
bun run build
bun run check
bun run test
```

Bun запускает package scripts; используйте `bun run test`, не `bun test`.
`bun run check:knip` проверяет неиспользуемые JS/TS-файлы, экспорты и зависимости
во всех workspace-пакетах. Проверка входит в `check:source`, `check` и CI.
Knip использует штатные плагины; дополнительные точки входа и исключения
описаны в `knip.jsonc`. CSS-импорты отдельно не анализируются; зависимости,
используемые только в стилях, явно отмечены в конфигурации.
Справочник: [настройка Knip](https://knip.dev/overview/configuration).
Для своего Chromium задайте `CHROME_BIN`. На Ubuntu 26.04 с закреплённым
Playwright при отсутствии браузерной сборки используйте
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` перед установкой и тестами.

Исходники меняются в `src`, результаты пересобираются. Сайт статический, без
runtime-фреймворка и гидрации; главная не содержит Twitch iframe/чата. Деплой в
Cloudflare — `bun run deploy:website`: он собирает корневой `dist` через
`wrangler.jsonc` и публикует его. Публикация — отдельная операция от проверки
исходников.

## Установка и оформление

- [Windows: установка, обновление, откат и выпуск релиза](docs/windows-releases.md).
- [Подключение OBS, Streamer.bot и Companion из исходников](docs/local-installation.md).
- [Дизайн, движение и генерация оформления](docs/design.md).
- [Правила изменения репозитория](AGENTS.md).

Рабочие настройки, базы, токены и резервные копии приложений не входят в Git.
Сборка не устанавливает модули, не переключает сцены и не публикует сайт.
Сохраняйте лицензии проекта, стороннего кода и Unbounded, включая встроенные уведомления.

## Общие документы

- [История изменений](CHANGELOG.md) — единый журнал выпусков и прежняя история продуктов.
- [Участие в проекте](CONTRIBUTING.md).
- [Кодекс поведения](CODE_OF_CONDUCT.md).
- [Политика безопасности](SECURITY.md).
- [Лицензия MIT](LICENSE) — собственный код проекта. Для стороннего кода и ресурсов действуют сохранённые рядом лицензии и уведомления, включая [DonationAlerts](integrations/streamerbot/donationalerts/LICENSE) и [Unbounded](packages/design/licenses/Unbounded-OFL.txt).

README продуктов содержат локальные инструкции; общие правила и история изменений ведутся в корне.
