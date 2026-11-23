# Подключение из исходников

Для готового Windows-комплекта используйте [инструкцию ZIP](windows-releases.md).
Ниже — работа с checkout. Windows-приложениям нужны постоянные Windows-пути.

## OBS

Соберите нужный продукт из корня: `bun run build:stream-info`, `bun run build:tuna`
или `bun run build:widgets`. Результаты — в корневом `dist/<продукт>/`.
Изображения экспортируются отдельно: [artwork](../artwork/README.md).

Подключите HTML/изображения через OBS, сохраняя ID, размеры, положение и URL-параметры;
после замены файлов перезагрузите док или браузерный источник.
Шаблоны HTML/CSS/JS чата и CSS DonationAlerts устанавливаются отдельно
через интерфейс провайдера: [OBS widgets](../apps/obs-widgets/README.md).

Если нужны копии ресурсов вне checkout:

```bash
bun run sync:local --product stream-info --obs-root <каталог-OBS>
```

Группы: `stream-info`, `tuna`, `widgets`. `--obs-root` — каталог, содержащий папку
`Streamer.bot`; по умолчанию используется родитель checkout. Команда показывает план.
`--apply` копирует ресурсы с резервной копией в `Streamer.bot/backup/monorepo-sync-*`.
Настройки приложений и C# она не обновляет.

## Streamer.bot и Stream Deck

Перед импортом сохраните штатные экспорты. C# обновляйте в существующих Actions,
сохраняя ID, и компилируйте Execute Code внутри Streamer.bot.
Для Stream Info используйте `dist/stream-info/streamerbot-import.txt`: HTML не заменяет
API; док редактирует Twitch и YouTube, а YouTube — только во время эфира.
Звук чата лежит рядом с C# в `integrations/streamerbot/chat-sound/`; путь в C#
рассчитан на checkout рядом с папкой Streamer.bot.
Действия для Stream Deck — в `integrations/streamerbot/stream-deck/`, жизненный
цикл YouTube-записи — в `integrations/streamerbot/vod/`.
DonationAlerts требует приватную глобальную `daClientSecret`. Визуальные алерты и
голосовые донаты показывает нативный виджет DonationAlerts; Streamer.bot отправляет
сообщение в чат через `DonationHandler_Default`. AI-модерация и сервер
`127.0.0.1:7480` удалены; источники `ДОНАТ` и `ДОНАТЕРЫ` используют нативные
ссылки виджетов. Подробности — в
[README интеграции](../integrations/streamerbot/donationalerts/README.md).

C# можно проверить командой `bun tooling/local/compile-streamerbot.ts` с
`STREAMERBOT_ROOT`, против DLL установленного приложения; это не заменяет Execute Code.
Не выполняйте Actions ради проверки и не редактируйте живые базы.
Для отката верните ресурсы из backup и C# через штатное восстановление.
