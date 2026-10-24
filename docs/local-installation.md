# Подключение из исходников

Для обычной Windows-установки используйте [готовый релиз](windows-releases.md).
Ниже — подключение ресурсов из checkout и отдельные операции импорта.
Исходники в WSL не заменяют постоянные Windows-пути работающих приложений.

## OBS и браузерные ресурсы

Сначала выполнить `bun run build` из корня. HTML лежат в `apps/*/dist`,
изображения — в `artwork/scenes/rendered` и `artwork/logo/rendered`.
Публиковаться должны прежние имена файлов: Stream Info —
`change-info-streamer-bot.ru.html`, Tuna — `obs-tuna-widget.html`.
Менять пути через OBS, сохраняя ID, размеры, положение и URL-параметры.
После обновления файлов перезагрузить соответствующий док/браузерный источник.

Для совместимых копий в установке Streamer.bot доступен
`bun run sync:local --product stream-info`; группы — `stream-info`, `tuna`,
`widgets`. По умолчанию используется соседний Streamer.bot; `--obs-root`
задаёт другую папку OBS. Без `--apply` показывается план; применение сохраняет
заменяемые файлы в `Streamer.bot/backup/monorepo-sync-*`.
Прямым ссылкам на checkout эти копии не нужны.

CSS чата/DonationAlerts устанавливается через интерфейс провайдера отдельно.
Шаблон Streamlabs с `{font_size}` / `{message_hide_delay}` нельзя напрямую
вставлять в OBS override. `prepareObsChatCss` в
`tooling/local/obs-provider-css.mjs` сохраняет прежний размер шрифта и исключает
анимации/keyframes, оставляя lifecycle провайдеру. При обновлении override
сохранять `overlay: true`, URL и остальные настройки. Custom JS устанавливается
отдельно. Не удалять встроенные шрифтовые лицензии.

## Companion и Streamer.bot

Перед изменением сохранить штатные экспорты. TGZ импортировать через менеджер
модулей Companion и выбрать версию в существующем соединении. SystemMicrophone
требует явный тип входа/выхода; VoiceStream — ID Actions запуска/остановки.
Не пересоздавать соединения, кнопки, базы и Junction; активный каталог данных
определять по приложению, а не по имени папки. Подробнее: [Companion](../integrations/companion/README.md).

C# импортировать в существующий Action с сохранением ID и проверкой Execute Code.
HTML не устанавливает C#. Звуки `notif.mp3` и `health-warning.mp3` лежат рядом
с C# в `integrations/streamerbot/chat-sound/` и `integrations/streamerbot/obs-health/`;
сборка widgets для них не нужна. Пути в C# рассчитаны на checkout `maseaaao.tv`
рядом с папкой Streamer.bot; при установке из ZIP задать пути к MP3 из комплекта.
DonationAlerts использует приватную глобальную
`daClientSecret`; не включать её в Git/HTML.

Запускатель `integrations/companion/start-companion.mjs` принимает
`--streamerbot-root` или `STREAMERBOT_ROOT`; по умолчанию использует соседний
`../Streamer.bot/custom/companion/data`. Проверить фактические данные до запуска.
Запуск: `bun integrations/companion/start-companion.mjs --streamerbot-root <путь>`.
Сам Companion запускается комплектным Node.
Для проверки уже запущенного процесса нужен штатный Windows Script Host/WMI
и соседний `companion-processes.wsf`; при ошибке проверки новый экземпляр не запускается.
`--open-admin` открывает панель после готовности. Старые параметры
`-StreamerbotRoot` и `-OpenAdmin` также поддерживаются.

Диагностика только чтением: задать `STREAMERBOT_ROOT`, затем выполнить
`bun tooling/local/check-stream-stack-cli.mjs` (русская сводка и отчёт в
`custom/maintenance/stream-stack-latest.json`). Для JSON в stdout оставлен
`bun tooling/local/check-stream-stack.mjs`. C# можно проверить из WSL командой
`bun tooling/local/compile-streamerbot.mjs` против DLL установленного приложения;
это не заменяет Execute Code внутри Streamer.bot.
Не менять живые данные на диске при работающем владельце. Откат ресурсов —
из backup, конфигураций/модулей — штатным восстановлением совместимого экспорта.
