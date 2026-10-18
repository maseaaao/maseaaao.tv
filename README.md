# maseaaao.tv

Сайт, оформление и собственные инструменты стрима. Один репозиторий, отдельные приложения и независимые версии. Светлое оформление: синий `#1616d9`, тёплый светлый `#f4f3ec`, текст `#20201e`.

| Каталог | Содержимое |
| --- | --- |
| `apps/website/public` | Редактируемый статический сайт |
| `apps/stream-info` | Twitch-док, C# API, импорт, локализации и тесты |
| `apps/tuna-widget` | Музыкальный виджет Tuna, автономный HTML |
| `apps/obs-widgets` | Чат, DonationAlerts CSS, соцсети, статистика, бейдж, звуки |
| `apps/brand-color-lab` | Самостоятельный редактор палитр |
| `packages/design` | Общая светлая палитра, шрифты и лицензии |
| `integrations/streamerbot` | DonationAlerts, Яндекс Музыка, OBS Health, игровые пресеты |
| `integrations/companion` | System Microphone, VoiceStream и общие помощники |
| `artwork` | Шаблоны и экспорты сцен, логотипов, баннеров, панелей, обоев |
| `tooling` | Генераторы, подготовка публикации, локальное обновление |
| `dist` | Готовая публикация для существующего Cloudflare-подключения |

## Установка

Node.js **22.20+ в ветке 22**, npm, .NET SDK 8, Python 3. Для пересборки шрифтов — `fonttools[woff]`. Единственный lockfile находится в корне.

```powershell
npm ci
npm run browser:install
npm run build:website
npm run check
npm run check:stream-info
npm test
npm run build:stream-info
npm run build:tuna
npm run test:brand-color-lab
```

Для установленного браузера задать `CHROME_BIN`; редактор палитр использует `BROWSER_EXECUTABLE_PATH`. `npm run build` готовит только сайт, без .NET и Windows. Генераторы оформления запускаются явно: `render:scenes`, `render:twitch-banner`, `render:wallpapers`. `full` перестраивает весь комплект и требует браузер и fonttools.

Сборка модулей Companion на Windows:

```powershell
npm run prepare:companion-libs
npm run build --workspace integrations/companion/system-microphone
npm run build --workspace integrations/companion/voice-control
npm run package --workspace integrations/companion/system-microphone
npm run package --workspace integrations/companion/voice-control
```

Сборка не устанавливает модули и не управляет приложениями.

## Рабочая установка

Приватные данные, базы, настройки, логи и резервные копии остаются вне Git. Пути OBS сохранены. Корневые `src` и `assets` могут существовать как игнорируемые копии для текущих источников OBS; редактировать нужно `artwork` и `packages/design`.

```powershell
# Только показать различия:
npm run sync:local -- --product stream-info
# Применить с резервной копией заменяемых файлов:
npm run sync:local -- --product stream-info --apply
```

Другие группы: `tuna`, `widgets`, `artwork`, `brand-color-lab`. [Обновление установленной копии](docs/local-installation.md).

## Публикация

Cloudflare продолжает использовать корневой `wrangler.jsonc` и `dist`. Готовый `dist` хранится в Git и проверяется на совпадение с подготовленным сайтом; вручную его не редактировать. Публичные маршруты сохранены. Если в Cloudflare задана отдельная команда сборки, использовать `npm run build:website` из корня.

Stream Info и Tuna имеют собственные версии, CHANGELOG и теги `stream-info-vX.Y.Z`, `tuna-widget-vX.Y.Z`. Workflow создаёт черновик выпуска и проверяет скачанные файлы; существующие артефакты не перезаписываются. Миграция сама не создаёт тегов.

[Архитектура](docs/architecture.md) · [Выпуски](docs/releasing.md) · [Перенос](docs/migration-20261019.md)
