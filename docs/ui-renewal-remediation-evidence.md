# Проверяемость UI Renewal: исходные контракты и ограничения

Дата: 2026-10-19. Основная ветка репозитория на момент анализа: `b0be32ea694db7d1fe097eb93315ceb08010864d`. Патчи реализованы последующей **detached** цепочкой Git-объектов; `main` не обновлялась, публикация не запускалась.

## Источники baseline

- `docs/ui-renewal-baseline.json`: размеры и SHA-256 **предыдущих** отслеживаемых артефактов, не текущие хеши после изменений.
- `docs/ui-renewal-inventory.md`: трассировка source → build → output → потребитель. Историческая строка `stream.js` теперь намеренно неактуальна: главный Twitch embed удалён решением владельца.
- `tests/fixtures/landing-upstream.json`: исторический набор якорей прежнего лендинга; не навязывать старую кратность Twitch-ссылок новому дизайну.
- `artwork/scenes/layout.json`: baseline координат, включая известное наложение music/donors у vertical-camera; это не новая ошибка миграции.
- `docs/remaining-work.md`: независимые задачи установки, Companion и Streamer.bot; не наследовать их статусы автоматически.

## Стабильные контракты после изменений

| Контракт                                         | Референс                                                                      | Статус при статическом ревью                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Главная без embedded Twitch и чата               | `apps/website/src/components/HomePage.vue`, `src/index.html`                  | Исходники обновлены; новый dist не собран        |
| Twitch и архивы доступны ссылками                | `HomePage.vue` и `WebsiteLink.vue`                                            | Ссылки сохранены в SFC                           |
| Диагностический checker по-прежнему умеет iframe | `apps/website/src/assets/check.js`                                            | Код не менялся                                   |
| Stream Info API v4, event и action               | `apps/stream-info/src/composables/useStreamInfo.ts` + `streamerbot/action.cs` | Идентификаторы не менялись                       |
| Ключи настроек Stream Info v1                    | `useStreamInfo.ts`                                                            | Названия сохранены                               |
| Ключ OBS Stats credentials v1                    | `apps/obs-widgets/src/output-stats/main.js`                                   | Идентификаторы сохранены, жизненный цикл изменён |
| Имена standalone exports и OBS путей             | `docs/local-installation.md`, `artwork/scenes/layout.json`                    | Не менялись                                      |
| Раздельная установка C#/Companion                | `docs/remaining-work.md`                                                      | Рабочие конфигурации не тронуты                  |

## Текущая техническая среда помощника

- GNU/Linux Debian 13; `node v22.16.0` (ниже обязательного Node 22.20+), npm 10.9.2; Python 3.13.5; системный Chromium 144.0.7559.96; `dotnet` отсутствует.
- Репозиторий доступен через GitHub connector, **но не примонтирован как рабочее дерево с `node_modules`**. Попытка доступа к GitHub через системный Git невозможна: имя хоста не разрешается. Здесь невозможно корректно выполнить `npm ci`, `npm run verify:ui-renewal`, локальное `git diff --check` и браузерные тесты собранных новых файлов.
- Исходники JS проверялись статическим синтаксическим парсером V8 в подключённой среде; это **не** равно ESLint/TS/Vue compilation или Windows OBS runtime.
- Проверки Windows 11/OBS CEF, Streamer.bot, реальные CSP Streamlabs/DonationAlerts, Companion packaging, изображения WEBP/PNG после пересборки, Lighthouse и публикация **не выполнялись**.

## Границы дальнейшей приёмки

1. На полноценном checkout с Node 22.20+, Python 3.11+ и .NET 8: `npm ci`, `npm run browser:install`, `python3 -m pip install -r tooling/artwork/requirements-fonts.txt`.
2. Выполнить `npm run verify:ui-renewal` и разобрать новые ошибки тестов (включая отладочные fixtures); сохранить build/test logs.
3. После визуального утверждения принять обновлённые управляемые WEBP/JPEG/PNG/ICO и `dist`. В противном случае `check:artifacts` обязан падать.
4. Для OBS/CEF отдельно проверить file:// crypto/IDB, reconnect, 2 параллельных source, прозрачность, читабельность и реальное размещение.
5. При установке использовать только dry-run → backup → отдельное согласование apply, затем хешировать реально загруженные экземпляры.

Изменения исходников, CI и тестов в detached-цепочке нельзя объявлять «выпущенными» или «полностью проверенными».
