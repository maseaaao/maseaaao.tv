# DonationAlerts → модерация → чат и OBS

[План ИИ-модерации в Streamer.bot](../../../docs/ai-moderation-plan.md): стадии,
решения и фактическое состояние живой установки 11.11.2026.

Интеграция принимает донаты, ставит их в локальную очередь и показывает имя, сумму,
текст и голос только после решения `allow`. Штатный виджет DonationAlerts заменён
локальным browser source `AI | Донат`; веб-панель встроена в Streamer.bot и открывается
как OBS Custom Browser Dock.

## Поток

```text
DonationAlerts → DonationHandler_After → зашифрованная очередь
                                           → OpenCode Go (основной)
                                              └→ DeepSeek API (резерв при сбое/неверном ответе)
                                           → allow / block / review
allow → чат Twitch/YouTube
      → /api/current → browser source AI | Донат (карточка + голосовое провайдера)
review → веб-панель → прослушать/разрешить/заблокировать/повторить
```

Сетевой слушатель не ждёт ИИ: `DonationHandler_After` только кладёт событие в очередь.
Проверка и показ работают в отдельных потоках Action `AI Moderation`. При сбое обоих
провайдеров, отсутствии ключа, переполнении или неверном ответе событие остаётся в
`review` и не выпускается.

## Actions

| Action / модуль                                         | Исходник и назначение                                                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `-- DonationAlerts Code` / `DonationAlerts Integration` | `DonationAlertsIntegration.cs`: подключение и обработка событий; `daId` и `daAudio`                                                            |
| `-- DonationAlerts Authorization`                       | `DonationAlertsAuthorization.cs`: OAuth через браузер                                                                                          |
| `-- DonationAlerts Background Watcher`                  | `DonationAlertsWatcher.cs`: запуск слушателя                                                                                                   |
| `DonationHandler_After`                                 | `DonationGate.cs`: только постановка в очередь, без чата                                                                                       |
| `OBS \| DonationAlerts \| Toggle`                       | `DonationAlertsToggle.cs` + `../obs-health/CompanionEndpoint.cs`: аварийное скрытие и звук alerts                                              |
| `AI Moderation`                                         | `ModerationHost.cs` + `ModerationEngine.cs` + `ModerationFiles.cs` + `ModerationOutput.cs` + `ModerationHistory.cs` + `ModerationWebServer.cs` |
| `AI Moderation \| Панель`                               | `ModerationUI.cs`: открывает `http://127.0.0.1:7480/` в браузере                                                                               |
| `AI Moderation \| Ручное`                               | `ModerationControl.cs`: `allow`, `block`, `retry`, `replay`, `stop`, `resume` по аргументам                                                    |

Порядок установки:

> Состояние текущей установки — в [плане](../../../docs/ai-moderation-plan.md),
> раздел «Живая установка 11.11.2026». Actions, ключи, источник и Dock уже созданы;
> повторно шаги 1–8 выполнять не нужно.
1. Сохраните резервную копию `data/actions.json`; при правке OBS закройте OBS и
   сохраните `basic/scenes/obsmainscenes.json` и `user.ini`.
2. Создайте **блокирующую** очередь `AI Moderation Worker` (без concurrent execution).
3. Создайте Action `AI Moderation`: Execute Code с именем `AI Moderation Engine`,
   шестью файлами из таблицы (включая `ModerationHistory.cs`), триггером
   `Streamer.bot Started` и очередью `AI Moderation Worker`; включите
   **Precompile on Application Start**. Action остаётся запущенным и держит очередь.
4. Создайте Action `AI Moderation | Панель`: `ModerationUI.cs`, без триггеров.
5. Создайте Action `AI Moderation | Ручное`: `ModerationControl.cs`, без триггеров.
   Аргументы: `moderationOperation`, `moderationPlatform`, `moderationId`.
   Не давайте этому Action публичный чат-триггер.
6. Замените код `DonationHandler_After` на `DonationGate.cs`, сохранив ID Action.
7. Обновите `-- DonationAlerts Code` кодом интеграции: без `daId` шлюз отклонит донат.
8. Замените штатный browser source `8️⃣ДОНАТЫ` на локальный `AI | Донат`:
   URL `http://127.0.0.1:7480/widget.html`, старый CSS очистите, ширину/высоту
   оставьте 1200×400. Это отключает старый alert, его звук и встроенный TTS.
   В `user.ini` добавьте Custom Browser Dock:
   `{"title":"МОДЕРАЦИЯ","url":"http://127.0.0.1:7480/"}`.
9. Соберите `apps/moderation-dock` и скопируйте `dist/moderation-dock/index.html`
   в `Streamer.bot/custom/moderation/index.html`.
10. Откройте панель, введите ключи, сохраните настройки, проверьте Go и DeepSeek
    кнопками, затем включите `OutputsReady` и снимите паузу.

## Веб-панель

- `GET /` — панель модерации; `GET /widget.html` — карточка для OBS.
- `GET /api/state` — очередь, статусы, настройки без ключей.
- `GET /api/current` — только активный разрешённый донат для виджета.
- `POST /api/review` — `allow`, `block`, `retry`, `replay`.
- `POST /api/history/import` — импорт старых донатов DonationAlerts (OAuth `oauth-donation-index`).
- `GET /api/history` — последние 500 импортированных записей.
- `POST /api/control` — `pause`, `resume`, `restart`.
- `POST /api/config` — ключи, модели, правила, таймаут, длительность, `OutputsReady`.
- `POST /api/test` — короткий живой запрос к выбранному провайдеру.
- `GET /api/audio?id=…&platform=…` — голосовое провайдера; для виджета нужен `token`.

Сервер слушает только `127.0.0.1:7480`; отдельного процесса нет. Ключи в браузер не
возвращаются. Кнопка `Перезапуск` пересоздаёт движок и потоки без перезапуска
Streamer.bot; `Пауза` сохраняется в `settings.dpapi`.

## Настройки и хранение

- Ключи, правила и очередь лежат в `%LOCALAPPDATA%\maseaaao.tv\moderation`
  (`settings.dpapi`, `queue.dpapi`) и зашифрованы DPAPI для текущего пользователя Windows.
  В репозиторий, логи и экспорты ключи не попадают.
- Голосовые файлы сохраняются в `%LOCALAPPDATA%\maseaaao.tv\moderation\audio`;
  сервер отдаёт только файлы из этой папки с проверкой расширения.
- `Paused=true` по умолчанию; без `OutputsReady` вывод заблокирован. Это защита от
  случайного двойного показа.
- Текст терминальных событий хранится 24 часа, `review` — 7 дней, `historical` — 30 дней, ID — 30 дней;
  после этого содержимое вычищается, ID остаётся для дедупликации.
- Если `queue.dpapi` повреждён или недоступен, `AI Moderation` не стартует и ничего
  не выпускает. Сохраните файл для разбора и переименуйте его только вручную;
  ключи при этом не теряются, потому что лежат в отдельном `settings.dpapi`.
- Голосовые донаты всегда идут в `review`: автоматического распознавания речи нет.
  Владелец слушает файл в панели и только потом разрешает; после `allow` файл
  воспроизводит browser source `AI | Донат`. Windows TTS не используется.
- **История DonationAlerts**: вкладка `История` и кнопка `Загрузить историю`
  загружают старые донаты через `/api/v1/alerts/donations`
  (до 100 страниц по 30 записей, дедупликация по ID). Они получают статус `historical`
  («История») и считаются разрешёнными по умолчанию, но **не выводятся автоматически**
  в чат/OBS; для показа используйте `Повтор`. Импорт не скачивает старые голосовые файлы.
- Кнопка `Повтор` доступна почти для любого статуса, кроме `checking` и `displaying`:
  она переводит событие в `allowed` и снова выводит его в чат и OBS. Для уже показанного
  доната это создаёт дубль в чате — используйте осознанно.

## Провайдеры

- **OpenCode Go** — основной: `https://opencode.ai/inference/go/openai/v1/chat/completions`,
  модель по умолчанию `deepseek-v4.1-flash`; модель и reasoning (`low`, `medium`,
  `high`, `xhigh`, `max`, `none`; по умолчанию `medium`) выбираются в веб-панели.
  Заголовок `x-opencode-session`.
  Живой тест 11.11.2026 вернул `allow`.
- **DeepSeek API** — резерв: `https://api.deepseek.com/chat/completions`,
  модель `deepseek-flash`, thinking отключён. Живой тест 11.11.2026 вернул `allow`.
- Контракт ответа строгий: ровно `decision` (`allow`, `block`, `review`) и `reason`.
  Код-ограждения, лишние поля и произвольный текст отклоняются; ошибка формата
  никогда не превращается в `allow`.

## Ограничения

- В текущей интеграции DonationAlerts нет событий подписок; отдельные платные
  события не подключены. Для них нужен тот же `Enqueue`, но это отдельная проверка.
- Реальный платный донат в эфире ещё не проверен. Тестовый донат провайдера
  `192144678` прошёл цепочку и был показан; синтетические QA-события проверяли
  карточку и голосовое воспроизведение.
- Панель не имеет пароля; не публикуйте порт 7480 наружу и не открывайте его через
  туннель. Доступ к `/api/config` и `/api/review` имеет любой локальный процесс.
- При смене коллекции OBS нужно снова проверить URL/имя источника; аварийный
  `DonationAlertsToggle` ищет источник по UUID.

Проверка движка без запуска Streamer.bot:

```text
STREAMERBOT_ROOT=<установка> \
  dotnet run --project integrations/streamerbot/donationalerts/ModerationTests.csproj -c Release
→ PASS 76 assertions
```

`TestMessages.cs` и `TestSocketService.cs` используют подставные сервисы.
Проверка компиляции описана в инструкции подключения из исходников репозитория;
она не заменяет проверку в эфире.

## Аварийное отключение alerts

`DonationAlertsToggle.cs` устанавливается вместе с `CompanionEndpoint.cs` в один
Execute C# Code. Action использует отдельную блокирующую очередь, без триггеров и
без concurrent execution. Companion вызывает его через `POST /DoAction`, имя
`OBS | DonationAlerts | Toggle`.

Первое нажатие сохраняет состояние, отключает звук эфира и мониторинг, затем скрывает
все экземпляры источника `AI | Донат` по UUID, включая группы. Второе возвращает
сохранённые видимость, mute и мониторинг. Состояние восстановления сохраняется в
глобальной переменной `donationalerts.panic.snapshot.v1`; при ошибке оно не удаляется.

Браузер должен продолжать работать, когда скрыт (`Shutdown source when not visible`
выключен). Кнопка не отменяет донат у провайдера: раннее включение может вернуть
оставшуюся часть текущего оповещения. Она не скрывает список донатеров.

В Companion нужны custom variables `da_alerts_label` и `da_alerts_blocked`.
Подпись кнопки — `$(custom:da_alerts_label)`; значение `da_alerts_blocked=1` означает
выключенное состояние либо ошибку. `Init` только читает OBS и синхронизирует подпись;
внешние ручные изменения OBS между нажатиями автоматически не отслеживаются.

Основа: [play-code-live/streamer.bot-donationAlerts](https://github.com/play-code-live/streamer.bot-donationAlerts).
Сохраняйте [лицензию MIT](LICENSE).
