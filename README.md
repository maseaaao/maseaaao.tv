# maseaaao.tv

Сайт, оформление OBS и инструменты стрима. Один репозиторий, один релиз
`vX.Y.Z`, один ZIP с папками продуктов и `updater/`.

## Продукты

| Каталог                                                    | Назначение                                                |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [apps/website](apps/website/README.md)                     | Статический сайт на HTML+TS; публикация в корневом `dist` |
| [apps/stream-info](apps/stream-info/README.md)             | Русский док Twitch, C# API и импорт Streamer.bot          |
| [apps/tuna-widget](apps/tuna-widget/README.md)             | Автономный музыкальный виджет                             |
| [apps/obs-widgets](apps/obs-widgets/README.md)             | Соцполоса, чат, CSS провайдеров и звуки                   |
| [integrations/companion](integrations/companion/README.md) | Модули и запускатель Companion                            |
| `integrations/streamerbot`                                 | Интеграции Streamer.bot                                   |
| `artwork`                                                  | Логотип, сцены, баннеры, панели и обои                    |
| `packages`                                                 | Общие дизайн-токены, UI и конфигурации сборки             |
| `tooling`                                                  | Сборка, проверки, генераторы и установка                  |

## Разработка

Работать в Linux/WSL2 с Linux-версиями Bun и Node из `.bun-version` и
`.node-version`. Нужны Python 3 и .NET SDK 8; для видео сцен — FFmpeg с
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
Python-launcher берёт `python3`/`python` из PATH. Для своего Chromium задайте
`CHROME_BIN`. На Ubuntu 26.04 с закреплённым
Playwright при отсутствии браузерной сборки используйте
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` перед установкой и тестами.

Исходники меняются в `src`, результаты пересобираются. Сайт работает без Vue
runtime и гидрации; главная не содержит Twitch iframe/чата. Cloudflare берёт
`wrangler.jsonc` и корневой `dist`; публикация — отдельная операция.

## Установка и оформление

- [Windows: установка, обновление, откат и выпуск релиза](docs/windows-releases.md).
- [Подключение OBS, Streamer.bot и Companion из исходников](docs/local-installation.md).
- [Дизайн, движение и генерация оформления](docs/design.md).
- [Правила изменения репозитория](AGENTS.md).

Рабочие настройки, базы, токены и резервные копии приложений не входят в Git.
Сборка не устанавливает модули, не переключает сцены и не публикует сайт.
Сохраняйте лицензии продуктов и Unbounded, включая встроенные уведомления.
