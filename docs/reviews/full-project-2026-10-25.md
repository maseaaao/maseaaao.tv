# Полное ревью maseaaao.tv

Дата начала: 25 октября 2026, Asia/Almaty.
Проверяемый снимок: [33961514ab13ba5e56d4cbe6b337a486aca29581](https://github.com/maseaaao/maseaaao.tv/commit/33961514ab13ba5e56d4cbe6b337a486aca29581).
PR создан с пустым документом до начала ревью. Находки добавляются последовательными коммитами непосредственно в ветку PR.

**Статус: ревью продолжается.** Это промежуточная версия, не итоговое заключение.
Исходники и рабочие приложения не изменяются. Эфир, звук, Actions, аккаунты, конфигурации и публикация не используются для проверки.

Приоритеты: P1 — существенное нарушение основного сценария/безопасности; P2 — воспроизводимый дефект отдельного сценария; P3 — ограниченная проблема согласованности или сопровождения.
«Статический разбор» означает доказательство по потоку исполнения, а не запуск интеграции. Отдельно отмечаются динамические проверки и ограничения.

## Подтверждённые находки

### R01 · P2 · Частичное обновление Twitch обходит инвалидацию кеша при исключении

- Код: [action.cs:299–332](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/stream-info/streamerbot/action.cs#L299-L332).
- `UpdateTwitch` выполняет запись title, затем category, затем tags. Проверки последующих полей и вызовы CPH могут бросить исключение после уже успешной записи. `StateCache.Invalidate()` выполняется только в конце метода.
- Пример: заполнить кеш через getState, передать новый корректный title и некорректные tags либо получить исключение на втором вызове CPH. Title уже изменён, но ответ содержит `data=null`, без информации об успешно записанном поле; последующий getState в пределах TTL возвращает старый title.
- В интерфейсе `updatePlatform` после ошибки вызывает `refreshState(false)`, поэтому это непосредственно влияет на отображаемое состояние, а не только на внутренний API.
- Исправление: валидировать весь payload до первой записи; сбрасывать кеш в finally после начала внешних изменений и сохранять сведения о частично выполненных полях при сбое. TTL 5 секунд сохранять.
- Подтверждение: статический разбор порядка вызовов и обработчика исключений `Execute`. Живой Twitch не изменялся.

### R02 · P3 · Разные стандартные шаблоны заголовка в клиенте и C#

- Код: [templates.ts:4](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/stream-info/src/templates.ts#L4), [action.cs:23](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/stream-info/streamerbot/action.cs#L23), [controller.ts:469–487](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/stream-info/src/controller.ts#L469-L487).
- Клиентский default: `🔴 %subtitle%| !tg !yt !tw !donate`; серверный: `🔴 %subtitle%| !tg !yt`.
- На чистой установке getState возвращает серверный default даже при `configured=false`; `syncTemplates` принимает его, поскольку локального пользовательского шаблона ещё нет. Кнопка сброса затем устанавливает уже другой default.
- Последствие: первый запуск и сброс дают разные заголовки; команды !tw и !donate появляются/пропадают в зависимости от способа инициализации.
- Исправление: выбрать один default и подставлять его в C# при генерации импорта либо проверять точное соответствие обеих реализаций.
- Подтверждение: статический разбор констант и пути первой синхронизации.

## Проверки и покрытие — промежуточно

- Прочитаны README, AGENTS, README приложений, общая сборочная конфигурация, workflow Verify/Release/Deploy, код релизного черновика, маршрутизация, Stream Checker, Tuna, контроллер Stream Info и C# Action.
- Bun 1.4.4 установлен отдельно для ревью; `bun install --frozen-lockfile` успешно: 275 пакетов. Lockfile не изменялся. Заблокированный install-скрипт не разрешался.
- `bun run check` выполняется; подготовка Chromium выполняется.
- Остальные результаты и покрытие будут добавлены в следующих коммитах.

## Дополнение 1 — инструменты разработки

### R03 · P2 · Проверка исходников требует результатов сборки

- Код: [knip.jsonc:31–46](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/knip.jsonc#L31-L46), [vite.config.ts:20–36](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/website/vite.config.ts#L20-L36), [render.ts:7](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/stream-info/src/render.ts#L7).
- На чистом checkout после frozen install команда `bun run check` завершается с кодом 2 на Knip: `Error loading apps/website/vite.config.ts (ENOENT ... dist/artwork/brand/website)`; дополнительно `Unresolved imports: ../../../dist/.cache/stream-info/streamerbot-import.txt?raw`.
- Vite-плагин Knip исполняет конфигурацию, где изображения читаются до сборки. При этом README и AGENTS обещают, что check не требует dist и ничего не собирает. Pre-push вызывает check, поэтому новая рабочая копия не может пройти штатную проверку без дорогостоящего экспорта artwork.
- Исправление: отделить чтение/генерацию assets от загрузки конфигурации либо настроить статический анализ конфигурации и точечное разрешение generated import. Не создавать фиктивные картинки и не добавлять сборку в check.
- Подтверждение: реально выполнен чистый frozen install и `bun run check`; типы и check:repository затем выполнены отдельно и прошли.
- Дополнительный результат Knip: `Unused devDependencies: lefthook`. Проверяется отдельно после подготовки outputs, чтобы не смешивать причины.

### R04 · P2 · Dev launcher открывает настоящий Stream Info и Tuna вместо обещанного демо

- Код: [tooling/dev.ts:138–151](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/tooling/dev.ts#L138-L151), [main.ts](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/dev-launcher/src/main.ts), [controller.ts:205–206](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/stream-info/src/controller.ts#L205-L206), [Tuna main.ts](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/apps/tuna-widget/src/main.ts).
- README обещает тестовые данные без обращений к реальным сервисам. Launcher передаёт обычные корневые URL без `?demo=1`; Stream Info включает демо только по query/explicit option, иначе подключается к WebSocket 127.0.0.1:8080. Tuna всегда запускает fetch к localhost:1608, mock-провайдера нет.
- Последствие: просмотр интерфейса обращается к установленным локальным сервисам; в Stream Info доступны настоящие операции изменения метаданных и запуска пресетов. Само открытие не запускает эфир, но среда не изолирована от рабочих данных.
- Исправление: явно передавать demo для Stream Info, внедрить тестовый транспорт/данные Tuna в dev-просмотр; реальное подключение делать отдельным осознанным режимом и точно описать его.
- Подтверждение: статический путь launcher → iframe.src → start/connect/poll; локальный запуск launcher подтвердил корневые URL без query. Реальные сервисы не вызывались.

### Промежуточные результаты выполнения

- `check:types`: все приложения, tooling, Companion и build-config прошли.
- `check:repository`: прошёл.
- `build:stream-info`, `build:tuna`, `build:widgets`: прошли.
- `bun run test`: 99 тестов Stream Info прошли, 0 ошибок; все три набора Companion прошли, включая 11 runtime/configuration/reconnect checks. Внешние операции подменены.
- Загрузка Chromium 156 через `browser:install` не удалась: вместо ZIP сервер загрузки возвращает HTML «Site Unavailable». Это ограничение данной среды, не подтверждённый дефект проекта.
