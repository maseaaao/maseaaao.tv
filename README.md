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

Нужны Bun 1.4.4 из `.bun-version`, Node.js 22.23.3 из `.node-version`, Python 3 и .NET SDK 8. Для пересборки Unbounded нужен `fonttools[woff]`. Менеджер пакетов — Bun workspaces; единственный JavaScript-lockfile — `bun.lock` в корне. Установка Bun и PATH описаны в [инструкции Linux/WSL2](docs/linux-development.md).

Разработка и все задачи CI выполняются в Linux; на Windows используйте WSL2. Аудиопомощники Companion кросс-компилируются через .NET SDK и NuGet reference assemblies в Windows EXE. Streamer.bot, Companion, OBS, их запускатели и управление Windows-аудиоустройствами продолжают работать непосредственно в Windows. Растровый эталон привязан к Linux. Подробнее: [разработка в Linux/WSL2](docs/linux-development.md).

```bash
bun install --frozen-lockfile
bun run browser:install
bun run verify:ui-renewal
```

Для установленного браузера можно задать `CHROME_BIN`. Временные тестовые каталоги создаются в системной временной папке и удаляются после тестов.

Полная команда приёмки требует также `python3 -m pip install -r tooling/artwork/requirements-fonts.txt` и .NET SDK 8. Она проверяет воспроизводимость всех управляемых результатов по Git.

Генераторы запускаются явно: `render:logo`, `render:scenes`, `render:banners`, `render:twitch-description`, `render:wallpapers`, `render:favicon`. `full` перестраивает весь комплект. Обои: `desktop-4k.png` 3840×2160 и `portrait-4k.png` 2160×3840.

## Установка и публикация

Для установки готовых выпусков в Windows предусмотрен [обновлятор релизов](docs/windows-releases.md): один продукт, все последние стабильные продукты или закреплённый комплект версий. `tooling/windows/Update-All.ps1` показывает план, `-Apply` скачивает и устанавливает файлы в отдельный runtime с откатом. Исходники могут находиться в WSL; рабочие приложения используют постоянные Windows-пути. Первоначальное подключение этих путей выполняется отдельно; существующие прямые ссылки в репозиторий автоматически не меняются.

OBS читает изображения непосредственно из `artwork`; корневых совместимых `src/assets` нет. HTML для рабочих приложений обновляются через `sync:local` с предварительным просмотром и резервированием. Код C# и модули Companion устанавливаются отдельно с сохранением ID и настроек.

Cloudflare использует корневой `wrangler.jsonc`, команду `bun run build:website` и каталог `dist`. Готовый dist хранится в Git и проверяется CI; его собирают из исходников, а не редактируют вручную.

[Архитектура](docs/architecture.md) · [Установка](docs/local-installation.md) · [Выпуски](docs/releasing.md)

[План локальных доработок и миграции](docs/local-migration-plan.md) · [Результаты установки 20.10.2026](docs/local-migration-results.md)

## Качество и общие пакеты

`bun run check` запускает Biome 2.6.2 (форматирование, импорты, JS/TS, Vue/HTML и CSS, без предупреждений), проверки политики исходников, vue-tsc и предметные проверки. Безопасные исправления: `bun run check:fix`; отдельно доступны `format`, `format:check`, `lint` и `lint:fix`. Правила и ограничения миграции описаны в [docs/biome.md](docs/biome.md). Публичные API и fixtures проверяются подставными обработчиками.

Bun устанавливает зависимости с `linker = "isolated"` в `bunfig.toml`; `trustedDependencies` в корневом `package.json` разрешает install-скрипты только `esbuild` и `sharp`. Это перенос менеджера пакетов и запуска npm-скриптов, а не полная замена runtime: `node:test` и Node-инструменты продолжают использовать закреплённый Node, Python и .NET остаются отдельными требованиями.

`bun run test` сначала собирает все браузерные продукты, затем выполняет `test:checks`. C#-проверки требуют .NET SDK 8; сборка и упаковка Companion выполняются в Linux/WSL2. `test:repository` последовательно выполняет все корневые контракты и браузерные тесты; `test:website` оставлен совместимым alias, а не отдельным набором сайта.

`@maseaaao/design` экспортирует шрифты/токены, `@maseaaao/ui` — AppButton, FieldInput, IconIndicator, LiveStatusBadge и доступные UI-примитивы, `@maseaaao/build-config` — preset автономного HTML и PostCSS. Runtime не импортирует build-конфигурацию. [Устройство сборок](docs/build-toolchain.md).

Сайт предварительно рендерится из Vue SFC при сборке: готовые страницы работают без Vue runtime и гидрации. Главная — статическая страница ссылок без Twitch iframe, чата и клиентского SDK; интерактивные плееры есть только у самостоятельного диагностического Stream Checker. [Разработка сайта](apps/website/README.md).

[Сверка переноса Streamer.bot/custom](docs/custom-migration.md).

[Система анимаций: сайт, Stream Info и эфирные виджеты](docs/motion-system.md).

Быстрая проверка исходников: `bun run check:source`. Сборка всех продуктов и UI по графу: `bun run verify:products`; повторный запуск восстанавливает outputs из локального кеша. Полная приёмка выполняется в Linux/WSL2 и проверяет точные байты растров. [Граф, affected CI и ограничения миграции](docs/bun-migration.md).
