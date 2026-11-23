# DonationAlerts → чат и OBS

Интеграция принимает донаты DonationAlerts, отправляет сообщение в чат YouTube
(и Twitch, если он подключён) и даёт кнопку аварийного скрытия алертов. Визуальные
алерты и голосовые сообщения показывает нативный виджет DonationAlerts в OBS.

AI-модерация и локальный сервер `127.0.0.1:7480` удалены. Алерты и статистика
показываются нативными виджетами DonationAlerts в источниках OBS `ДОНАТ` и
`ДОНАТЕРЫ`.

## Actions

| Action / модуль                                         | Исходник и назначение                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `-- DonationAlerts Code` / `DonationAlerts Integration` | `DonationAlertsIntegration.cs`: подключение и обработка событий; `daId` и `daAudio` |
| `-- DonationAlerts Authorization`                       | `DonationAlertsAuthorization.cs`: OAuth через браузер                               |
| `-- DonationAlerts Background Watcher`                  | `DonationAlertsWatcher.cs`: запуск слушателя после старта Streamer.bot              |
| `DonationHandler_Default`                               | `DonationHandler_Default.cs`: сообщение о донате в чат YouTube/Twitch               |
| `OBS \| DonationAlerts \| Toggle`                       | `DonationAlertsToggle.cs`: скрыть/показать и замьютить браузерный источник алертов  |

## Установка

1. Сохраните резервную копию `data/actions.json`.
2. Импортируйте Actions из `dist/windows-integrations/actions/donationalerts/`.
3. В OBS источник `ДОНАТ` должен указывать на нативную ссылку виджета алертов
   DonationAlerts (Настройки → Виджеты → Alerts); `ДОНАТЕРЫ` — на виджет статистики.
4. `DonationHandler_Default` не требует очереди и не блокирует другие действия.
   `OBS | DonationAlerts | Toggle` использует UUID входа `2f2c20ab-…` из
   `DonationAlertsToggle.cs`; при переносе в другую коллекцию проверьте UUID.

## Проверка

- `DonationAlertsToggle.cs` проверяется `TestDonationAlertsToggle.cs` и
  `TestSocketService.cs` на подставных обработчиках.
- `DonationHandler_Default.cs` проверяется компиляцией через
  `bun run test:csharp` (нужен .NET SDK 8) или `STREAMERBOT_ROOT=… bun
  tooling/local/compile-streamerbot.ts --only DonationDefault`.

Секреты DonationAlerts хранятся в persistent variables Streamer.bot, не в Git.
