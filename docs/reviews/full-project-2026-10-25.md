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

## Дополнение 2 — безопасность и авторизация

### R05 · P2 · Middleware Artwork отдаёт закрытые файлы репозитория

- Код: [tooling/dev.ts:84–111](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/tooling/dev.ts#L84-L111).
- `artworkOutsideAssets` проверяет существование пути, затем читает любой файл из корня репозитория. Словарь MIME-типов не является allowlist: неизвестные расширения отдаются как application/octet-stream. Проверки Vite для .env/.git здесь обходятся собственным middleware.
- Подтверждение: в изолированном checkout создан только искусственный `.env.review-sentinel` со строкой `REVIEW_SENTINEL=synthetic-no-secret`; после запуска dev запрос к `http://127.0.0.1:5186/.env.review-sentinel` вернул HTTP 200 и содержимое. Файл удалён после проверки; настоящие секреты не читались.
- Граница риска: сервер сейчас слушает 127.0.0.1, это не доказательство утечки из production или удалённой эксплуатации через Интернет. Проблема проявляется у получившего доступ к dev-порту, в том числе при туннеле/проксировании.
- Исправление: разрешать только конкретные ресурсные каталоги и поддерживаемые расширения, проверять realpath и обычный файл; остальные запросы передавать Vite. Правило deny должно сохраняться.
- Основание: [Vite server.fs.deny](https://vite.dev/config/server-options#server-fs-deny).

### R06 · P2 · OAuth DonationAlerts не связывает callback с начатой авторизацией

- Код: [DonationAlertsIntegration.cs:657–708](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs#L657-L708).
- `GetAuthLink` не генерирует state/PKCE. Listener принимает первый запрос, извлекает только `code` и сразу вызывает Handler; проверки одноразового значения, ошибки OAuth и происхождения авторизационной транзакции нет.
- Условие: активное окно авторизации на loopback-порту. Сторонний запрос может завершить текущую попытку, а подходящий код того же OAuth client не привязан к этой попытке. Возможность подмены учётной записи зависит от получения валидного кода и доставки callback; полноценная атака на аккаунт не выполнялась.
- Исправление: криптографически случайный одноразовый state на каждую попытку, проверка до обмена code, отклонение незапрошенных callback; PKCE при подтверждённой поддержке провайдером.
- Подтверждение: статический разбор формирования URL и callback.
- Основание: [RFC 9700, §2.1 и §4.7.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7.1).

### R07 · P2 · Авторизация DonationAlerts сообщает успех при неуспешном обмене code

- Код: [DonationAlertsIntegration.cs:673–693](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs#L673-L693), [ObtainAccessToken:104–121](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs#L104-L121).
- `Handler(code)` только сохраняет code; сразу после него страница безусловно показывает «DonationAlerts подключён» и закрывает listener. Обмен code через `ObtainAccessToken` выполняется позднее, уже после возврата `CreateAuthLink`, в `DonationAlertsAuthorization.cs`. Поэтому отсутствующий/просроченный code или отказ token endpoint выявляются после того, как пользователь уже увидел успех.
- Дополнительно таймер на 300000 ms создаётся с AutoReset=true и никогда не останавливается/не освобождается. Он обращается к изменяемому полю Listener; после повторной авторизации старый таймер может закрыть уже новую попытку раньше её пяти минут.
- Исправление: обрабатывать error/code и результат обмена, выдавать успех только после сохранения валидных токенов; listener и одноразовый timeout владеть одной попыткой и освобождать в finally.
- Подтверждение: статический разбор ветвей ошибки и времени жизни таймера. Авторизация пользователя не запускалась.

## Дополнение 3 — сборка и независимый блокер проверок

### R08 · P2 · Штатный check стабильно падает на зависимости lefthook

- Код: [package.json:70](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/package.json#L70), [knip.jsonc](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/knip.jsonc), [verify.yml](https://github.com/maseaaao/maseaaao.tv/blob/33961514ab13ba5e56d4cbe6b337a486aca29581/.github/workflows/verify.yml).
- После успешного `full` повторный `bun run check` завершается кодом 1: `Unused devDependencies (1): lefthook package.json:70:6`. Это отдельная причина отказа, сохраняющаяся после устранения отсутствующих generated assets из R03.
- Lefthook действительно нужен hooks; исправление — корректно описать его использование/точечное исключение для Knip, сохранив саму проверку зависимостей и hooks.
- Последствие: локальный check и тот же шаг Verify/Release блокируются на текущем исходном состоянии. Удалённый CI в рамках этой проверки не объявляется прошедшим.
- Подтверждение: два запуска check, до и после полной генерации.

### Новые результаты выполнения

- `full`: прошёл весь экспорт artwork и сборки website, Stream Info, Tuna, OBS widgets, Windows integrations (копирование/подготовка файлов, не запуск Windows).
- `build:ui`: прошёл.
- C# policy/backend suites прошли, включая 10 общих ranking fixtures. Из-за ошибки среды в CLI .NET (Process.GetStat) использована прямая компиляция тем же SDK Roslyn и запуск DLL через .NET 8, без изменения исходников тестов.
- Chromium для штатной загрузки недоступен; для проверки экспорта использован локально подготовленный Chromium 153 через поддерживаемый `CHROME_BIN`.
- Уточнена последовательность R07: страница успеха показывается **до** обмена code; обмен вызывается отдельным action после возврата CreateAuthLink.
