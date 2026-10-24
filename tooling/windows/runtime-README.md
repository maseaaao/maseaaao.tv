# Windows integrations

Эти файлы предназначены для Windows. Скачивание не меняет Actions, настройки OBS или Companion.

`actions/` содержит поддерживаемые C#-шаблоны интеграций и их инструкции для ручного обновления существующих Execute Code. Это код для среды Streamer.bot, не отдельные исполняемые файлы. Пути к ресурсам в шаблонах требуют настройки под выбранный runtime; скачивание шаблонов не меняет уже загруженный C#.

Перед запуском задайте `STREAMERBOT_ROOT` — полный Windows-путь к установленному Streamer.bot. Для `start-companion.mjs` и `diagnostics/check-stream-stack-cli.mjs` также можно передать `--streamerbot-root`. Не полагайтесь на расположение соседних папок после установки релиза.

Запуск: `bun start-companion.mjs --streamerbot-root <установка>` и
`bun diagnostics/check-stream-stack-cli.mjs --streamerbot-root <установка>`.
Сам Companion всегда запускается комплектным Node; отдельная установка Node.js не нужна.
Запускатель читает существующие рабочие данные; для проверки процесса нужны
штатный Windows Script Host/WMI и соседний `companion-processes.wsf`.
Ошибка WMI блокирует запуск второго экземпляра. `--open-admin` открывает панель.
Старые параметры `-StreamerbotRoot` и `-OpenAdmin` сохранены.
Диагностика выводит русскую сводку и сохраняет JSON в
`custom/maintenance/stream-stack-latest.json`; `check-stream-stack.mjs` сохраняет
прежний JSON-интерфейс. Приложения и рабочие данные не входят в релиз.

Установка вручную: распакуйте единый ZIP в новый каталог и следуйте INSTALL.md в его корне. Старый каталог сохраните для отката; автоматического обновлятора нет.
