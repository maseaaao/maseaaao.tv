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

## Streamer.bot и Companion

Перед импортом сохраните штатные экспорты. C# обновляйте в существующих Actions,
сохраняя ID, и компилируйте Execute Code внутри Streamer.bot.
Для Stream Info используйте `dist/stream-info/streamerbot-import.txt`: HTML не заменяет API.
Звуки лежат рядом с C# в `integrations/streamerbot/chat-sound/` и `obs-health/`;
пути в C# рассчитаны на checkout рядом с папкой Streamer.bot.
DonationAlerts требует приватную глобальную `daClientSecret`.

[Сборка, настройки и импорт Companion](../integrations/companion/README.md).
Запуск в Windows, с явно заданной установкой Streamer.bot:

```text
bun integrations/companion/start-companion.ts --streamerbot-root <путь>
bun tooling/local/check-stream-stack-cli.ts --streamerbot-root <путь>
```

Запускателю нужны Windows Bun, штатный Windows Script Host/WMI и соседний
`companion-processes.wsf`; сам Companion использует комплектный Node.
`--open-admin` открывает панель после готовности. Вместо пути можно задать `STREAMERBOT_ROOT`.
Диагностика читает состояние и записывает отчёт в
`logs/stream-stack-latest.json` установки Streamer.bot; JSON-интерфейс — `check-stream-stack.ts`.

C# можно проверить командой `bun tooling/local/compile-streamerbot.ts` с
`STREAMERBOT_ROOT`, против DLL установленного приложения; это не заменяет Execute Code.
Не выполняйте Actions ради проверки и не редактируйте живые базы.
Для отката верните ресурсы из backup, C# и модули — через штатное восстановление.

Папка данных Companion может храниться отдельно от Streamer.bot. Задайте
`COMPANION_CONFIG_DIR` с абсолютным путём к ней для запускателя и диагностики.
`STREAMERBOT_ROOT` или `--streamerbot-root` задаёт установленный Streamer.bot;
это другой каталог. Если `COMPANION_CONFIG_DIR` не задан, сохраняется прежний
путь `custom/companion/data` внутри Streamer.bot. Отчёт диагностики записывается
в `logs/stream-stack-latest.json` установки Streamer.bot.

Для штатного `Companion.exe` задайте также `COMPANION_CONFIG_BASEDIR` с тем же
прямым путём к данным. Не используйте архивную базу вместо текущей конфигурации.
