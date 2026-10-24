# Подключение из исходников

Для обычной Windows-установки используйте [релиз и обновлятор](windows-releases.md).
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
HTML не устанавливает C#. DonationAlerts использует приватную глобальную
`daClientSecret`; не включать её в Git/HTML. Для Яндекс Музыки проверить путь
`control.ps1`, сохраняя раздельные play/pause.

Запускатель `integrations/companion/start-companion.ps1` принимает
`-StreamerbotRoot` или `STREAMERBOT_ROOT`; по умолчанию использует соседний
`../Streamer.bot/custom/companion/data`. Проверить фактические данные до запуска.
Он использует комплектный Node Companion и не запускает второй экземпляр.

Диагностика только чтением: задать `STREAMERBOT_ROOT`, затем выполнить
`node tooling/local/check-stream-stack.mjs`. C# можно проверить из WSL командой
`python tooling/local/compile-streamerbot.py` против DLL установленного приложения;
это не заменяет Execute Code внутри Streamer.bot.
Не менять живые данные на диске при работающем владельце. Откат ресурсов —
из backup, конфигураций/модулей — штатным восстановлением совместимого экспорта.
