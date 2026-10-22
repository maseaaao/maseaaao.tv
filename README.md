# maseaaao.tv

Сайт, оформление OBS и собственные инструменты стрима. Один репозиторий, отдельные версии приложений. Интерфейсы на русском, светлое оформление. Unbounded — встроенный акцентный шрифт, Arial — системный основной.

| Каталог          | Назначение                                                  |
| ---------------- | ----------------------------------------------------------- |
| apps/website/src | Vue SFC → статический HTML; dist — публикация Cloudflare    |
| apps/stream-info | Русский автономный док Twitch, C# API и импорт Streamer.bot |
| apps/tuna-widget | Автономный музыкальный виджет Tuna                          |
| apps/obs-widgets | Соцполоса, статистика OBS, чат, CSS DonationAlerts и звуки  |
| packages/design  | Общая палитра, Unbounded и лицензия                         |
| artwork          | Логотип, баннеры, сцены, панели и два варианта обоев 4K     |
| integrations     | Исходники модулей Companion и интеграций Streamer.bot       |
| tooling          | Сборка, генераторы, проверка и установка ресурсов           |

## Разработка

Нужны Node.js 22.20+ в ветке 22, npm, Python 3 и .NET SDK 8. Для пересборки Unbounded нужен `fonttools[woff]`. Один lockfile — в корне.

```powershell
npm ci
npm run browser:install
npm run verify:ui-renewal
```

Для установленного браузера можно задать `CHROME_BIN`. Временные тестовые каталоги создаются в системной временной папке и удаляются после тестов.

Полная команда приёмки требует также `python3 -m pip install -r tooling/artwork/requirements-fonts.txt` и .NET SDK 8. Она проверяет воспроизводимость всех управляемых результатов по Git.

Генераторы запускаются явно: `render:logo`, `render:scenes`, `render:banners`, `render:twitch-description`, `render:wallpapers`, `render:favicon`. `full` перестраивает весь комплект. Обои: `desktop-4k.png` 3840×2160 и `portrait-4k.png` 2160×3840.

## Установка и публикация

OBS читает изображения непосредственно из `artwork`; корневых совместимых `src/assets` нет. HTML для рабочих приложений обновляются через `sync:local` с предварительным просмотром и резервированием. Код C# и модули Companion устанавливаются отдельно с сохранением ID и настроек.

Cloudflare использует корневой `wrangler.jsonc`, команду `npm run build:website` и каталог `dist`. Готовый dist хранится в Git и проверяется CI; его собирают из исходников, а не редактируют вручную.

[Архитектура](docs/architecture.md) · [Установка](docs/local-installation.md) · [Выпуски](docs/releasing.md)

[План локальных доработок и миграции](docs/local-migration-plan.md) · [Результаты установки 20.10.2026](docs/local-migration-results.md)

## Качество и общие пакеты

`npm run check` запускает Prettier, ESLint (включая типизированные TS-проверки и HTML), Stylelint, typecheck и предметные проверки. Исправления: `npm run format` и `npm run lint:fix`. Публичные API и fixtures проверяются подставными обработчиками.

`npm test` сначала собирает все браузерные продукты, затем выполняет `test:checks`. C#-проверки требуют .NET SDK 8; упаковка Companion — Windows. `test:website` готовит artwork HTML во временном build-каталоге и проверяет готовые публикации.

`@maseaaao/design` экспортирует шрифты/токены, `@maseaaao/ui` — AppButton, FieldInput, IconIndicator, LiveStatusBadge и доступные UI-примитивы, `@maseaaao/build-config` — preset автономного HTML и PostCSS. Runtime не импортирует build-конфигурацию. [Устройство сборок](docs/build-toolchain.md).

Сайт предварительно рендерится из Vue SFC при сборке: готовые страницы работают без Vue runtime и гидрации. Главная — статическая страница ссылок без Twitch iframe, чата и клиентского SDK; интерактивные плееры есть только у самостоятельного диагностического Stream Checker. [Разработка сайта](apps/website/README.md).

[Сверка переноса Streamer.bot/custom](docs/custom-migration.md).

[Система анимаций: сайт, Stream Info и эфирные виджеты](docs/motion-system.md).
