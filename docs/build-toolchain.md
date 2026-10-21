# Сборки, общий дизайн и качество кода

Актуальные локальные результаты Windows от 20.10.2026: [локальная миграция](local-migration-results.md). Ниже сохранены также исторические ограничения предыдущих сред. `test:ui` применяет закреплённое исправление Storybook 10.6.2 для Windows-разделителей путей и кириллицы; оно касается только тестовой зависимости и должно быть пересмотрено при её обновлении.

## Пакеты

| Пакет                    | Контракт                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@maseaaao/design`       | `brand.css`, `fonts.css`, `tokens.css`, `fonts/*`, `license`. Единственный источник Unbounded 400/600, полного Unicode-покрытия и OFL             |
| `@maseaaao/ui`           | Общие AppButton/FieldInput/IconIndicator/LiveStatusBadge и accessibility.css; подтверждённое переиспользование, без лишнего выделения компонентов |
| `@maseaaao/build-config` | `standaloneConfig` для Vite + singlefile, `providerPlugins` для PostCSS. Только build/dev-зависимость                                             |

Направление зависимостей: приложения используют design/ui; build-config использует design и инструменты сборки. Пакеты private, не публикуются в npm. Шрифты/CSS экспортируются исходными файлами и обрабатываются потребителем.

## Источники и результаты

| Команда                                                  | Источник                                             | Результат                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `build:website`                                          | apps/website/src SFC → Vue SSR + apps/website/public | корневой dist; прежние маршруты страниц, content hash у bundles                            |
| `build:stream-info`                                      | apps/stream-info/src                                 | dist/change-info-streamer-bot.ru.html и отдельный streamerbot-import.txt                   |
| `build:tuna`                                             | apps/tuna-widget/src                                 | dist/obs-tuna-widget.html                                                                  |
| `build:widgets`                                          | apps/obs-widgets/src                                 | apps/obs-widgets/dist: два standalone HTML, provider CSS/HTML/JS, sounds и transparent.png |
| `build:artwork`                                          | artwork + шаблоны сцен/layout.json                   | .build-cache/artwork; автономные HTML для просмотра и screenshot                           |
| `render:scenes`, `render:banners`, другие render-команды | подготовленные artwork HTML                          | существующие пути artwork/.../rendered и public images сайта                               |

`build:all` явно собирает Tuna, Stream Info, виджеты и сайт. Порядок workspaces не используется как планировщик. Сборки не переписывают исходники других продуктов. Каждый standalone HTML владеет отдельным output, поэтому соседние результаты не удаляются. Временные artwork HTML и staging находятся вне source.

Сайт публикует отдельный WOFF2 с content hash и preload. `/bundles/*` имеет immutable-кеш; ресурсы с постоянными URL продолжают ревалидироваться. В HTML/CSS для OBS шрифт встраивается вместе с OFL. `public` не применяется как источник UI-зависимостей standalone-продуктов. Исключение — social-strip/public/transparent.png: отдельный совместимый ресурс OBS, который Vite сохраняет при каждой сборке соцполосы; сам HTML его не запрашивает.

Для Streamlabs исходный CSS использует валидные `var(--provider-font-size)` и `var(--provider-hide-delay)`. После обработки PostCSS адаптер проверяет по одному маркеру и восстанавливает `{font_size}` / `{message_hide_delay}`. Генерируемый шаблон проверяется также после тестовых подстановок. Управление событиями и анимациями остаётся у провайдера; проверка локальных fixtures не доказывает CSP реального сервиса.

## Инструменты качества

- Prettier: JS/MJS/CJS/TS/CSS/HTML/JSON/Markdown; `format`, `format:check`.
- ESLint flat config: recommended JS, type-aware TS в приложении и тестах; HTML semantics/accessibility. Browser и Node globals заданы по контексту; Playwright callbacks имеют оба окружения, поскольку сериализуются в страницу.
- Stylelint standard: CSS и CSS в HTML. Форматирование принадлежит Prettier. Повторные CSS-селекторы и порядок специфичности допускаются для каскадных component/state overrides; duplicate declarations, неизвестные свойства и неверные значения по-прежнему проверяются.
- `typecheck` проверяет src и tests Stream Info. Фикстуры используют явные проверки значений вместо non-null assertions.
- `check:repository` проверяет предметные инварианты: структуру, единственный русский экспорт, обои, typography, наличие ресурсов и неизменяемую публичную статику.

`check` объединяет проверки качества и инвариантов. Сгенерированные outputs, двоичные файлы, vendor-ресурсы и build cache исключены из форматирования/линтинга; их содержимое проверяется build/browser-тестами. `package-lock.json` управляется npm.

## Проверки и воспроизводимость

После `npm ci`:

```sh
npm run browser:install
npm run build:all
npm run check
npm run test:checks
```

`npm test` дополнительно сам выполняет build:all. Для другого Chromium используется CHROME_BIN. C#-тестам нужен .NET SDK 8. Компиляция Windows helpers/упаковка Companion запускается отдельным Windows CI job.

Тесты проверяют готовые outputs: точные байты встроенного WOFF2/OFL, отсутствие статических внешних зависимостей, provider placeholders, шрифты/DOM/CSP, responsive layout, клавиатуру, сценовую геометрию и QR. Проверки эфира, аудио и внешних провайдеров используют подставные обработчики.

Playwright и Sharp используются через один renderImage; ICO кодирует png-to-ico. Проектными остаются layout.json, параметры экспортов, проверка QR с логотипом и render jobs. Воспроизводимость текстовых outputs проверяется чистой повторной сборкой. Для pixel diff закреплять ОС, Chromium и шрифтовую среду.

Каноническая среда полной CI-приёмки и побайтового сравнения существующих растровых экспортов — `windows-2025`, Node из `.node-version`, единая закреплённая версия Playwright и Python 3.12 через `setup-python`. Экспорты утверждены в Windows: Linux Chromium использует другой текстовый растеризатор и меняет байты даже при совпадающих исходниках, шрифтах и геометрии. Поэтому полный граф выполняется в Windows без исключений для изображений и без ослабления `check:artifacts`. Локальный Python вызывается как `python`, без зависимости от Windows-алиаса `python3`. Исторические Linux-проверки ниже не являются каноническим побайтовым эталоном изображений.

## Отдельные последующие работы

Миграция упаковки Companion на официальный @companion-module/tools и декомпозиция main.ts Stream Info остаются отдельными подпроектами, как предусмотрено ревью плана. Текущие Windows build/package и защитные проверки архивов сохранены. Обновление Vite major, изменение дизайна и установка ресурсов в живые приложения не включены в инфраструктурную миграцию.

## Ограничение dependency audit на 19.10.2026

`npm audit --omit=dev` не обнаружил уязвимостей. Полный audit сообщает 7 high-позиций, происходящих от одной проблемы `braces <=3.0.3` в dev-цепочке Stylelint → globby/fast-glob/micromatch. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) описывает переполнение стека при глубоко вложенных glob-паттернах; исправленной версии upstream пока нет. В этом проекте паттерны задаёт репозиторий, CLI не получает пользовательские сетевые запросы. Это ограничивает применимость атаки, но не устраняет уязвимость зависимости. Обходы версии и подавление advisory не добавлялись; после выхода исправления нужно обновить цепочку.

## Приёмка реализации 19.10.2026

- Проверенная среда: Node.js 22.23.3, Chromium 153 через CHROME_BIN; Linux. CI закрепляет Ubuntu 24.04 и Node из .node-version; browser revision задаётся lockfile Playwright.
- В рабочем дереве и чистом экспорте без Git-истории прошли npm ci, build:all, полный check (format/lint/typecheck/инварианты), 107 проверок сборок/интерфейсов и 75 Vitest-тестов Stream Info. Companion и local tests также прошли на подставных обработчиках.
- 47 файлов публикации/импорта совпали побайтово после чистой сборки. Проверены локальные ZIP/HTML обоих продуктов с полной лицензией; теги и релизы не создавались.
- Выполнены render:scenes и render:favicon; размеры, alpha, QR и соответствие сцен исходникам проверены тестами. Скриншоты сайта и Stream Info визуально проверены.
- C#-тесты в этой Linux-среде не подтверждены: .NET CLI ранее завершался ошибкой чтения сведений о процессе. Windows-сборка помощников/архивов и GitHub Actions для новых коммитов не проверены. Полный npm test не объявляется прошедшим вместо этих проверок.
- Рабочие OBS/Streamer.bot/Companion и CSS у провайдеров не обновлялись. Изменения подготовлены локально; предыдущий отказ автоматического разрешения push не обходился.

## Перенос сайта на Vue SSR

`apps/website/vite.config.mjs` использует общий `prepareVuePages`: официальный SSR готовит контент и стили SFC в собственный build cache, затем обычная web-сборка Vite публикует шесть готовых HTML. `buildVuePages` использует ту же подготовку для автономных fixtures. Сайт выбирает внешний WOFF2 Unbounded 400 с content hash; Vue runtime и компилятор в клиентских chunks запрещены. На главной Twitch media/чат и `stream.js` удалены по решению владельца; `check.js` остался только у диагностического Stream Checker. Маршруты, canonical, JSON-LD и SEO сохранены. Старый `theme.css` удалён; композиция использует семантические токены без второй темы.

## Разграничение LIVE и диагностического плеера

Главная не использует iframe, сторонний Twitch SDK и runtime-проверку эфира. Статус LIVE без безопасного авторизованного backend не публикуется. `check.html` остаётся самостоятельной диагностической страницей с ручным iframe, его тесты не относятся к главной.

## Полный граф приёмки UI Renewal

`npm run verify:ui-renewal` выполняет по порядку: source lint/typecheck, подготовку WOFF2/логотипа, однократную сборку artwork HTML, полный рендер 12 сцен и всех banners/panels/favicon/wallpapers/website art, сборку UI/stories и всех отдельных продуктов, сборку website **после** изображений, repository checks, браузерные/UI/C# тесты, и `check:artifacts` с `git diff --check`.

`npm run check:artifacts` сравнивает **все управляемые артефакты** с коммитом включая WEBP/PNG/JPEG/ICO, standalone HTML и import; отмечает новые или изменённые untracked файлы, формирует SHA-256 manifest в `.build-cache/verify/artifacts.sha256`. Если Chrome/Sharp/OS дают отличающиеся бинарные изображения, CI останавливается до явного принятия эталона. Не отключать проверку из-за недетерминизма. Рендеры не меняют исходники и живую установку OBS.

Команды доступны только после `npm ci`, установки Chromium и `python3 -m pip install -r tooling/artwork/requirements-fonts.txt`. Для полной приёмки C# нужен .NET 8, для Companion упаковки — Windows job. Отсутствие локальных инструментов — блокер запуска, а не зелёный результат.

При неуспешном CI временные сборки можно изучить во вкладке Actions → Artifacts: `standalone-tools` и `website-and-artwork-preview`. Наличие прикреплённых файлов не означает, что проверки пройдены. В частности, `check:artifacts` вправе падать до принятия обновлённого tracked baseline.
