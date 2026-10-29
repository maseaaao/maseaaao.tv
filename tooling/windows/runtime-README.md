# Windows integrations

Эти файлы предназначены для Windows. Скачивание не меняет Actions, настройки OBS или Companion.

`actions/` содержит поддерживаемые C#-шаблоны интеграций и их инструкции для ручного обновления существующих Execute Code. Это код для среды Streamer.bot, не отдельные исполняемые файлы. Пути к ресурсам в шаблонах требуют настройки под выбранный runtime; скачивание шаблонов не меняет уже загруженный C#.

Перед запуском задайте `STREAMERBOT_ROOT` — полный Windows-путь к установленному Streamer.bot. Для `start-companion.ts` и `diagnostics/check-stream-stack-cli.ts` также можно передать `--streamerbot-root`. Не полагайтесь на расположение соседних папок после установки релиза.

Запуск: `bun start-companion.ts --streamerbot-root <установка>` и
`bun diagnostics/check-stream-stack-cli.ts --streamerbot-root <установка>`.
Сам Companion всегда запускается комплектным Node; отдельная установка Node.js не нужна.
Запускатель читает существующие рабочие данные; для проверки процесса нужны
штатный Windows Script Host/WMI и соседний `companion-processes.wsf`.
Ошибка WMI блокирует запуск второго экземпляра. `--open-admin` открывает панель.
Старые параметры `-StreamerbotRoot` и `-OpenAdmin` сохранены.
Диагностика выводит русскую сводку и сохраняет JSON в
`custom/maintenance/stream-stack-latest.json`; `check-stream-stack.ts` сохраняет
прежний JSON-интерфейс. Приложения и рабочие данные не входят в релиз.

Установка вручную: распакуйте единый ZIP в новый каталог и следуйте INSTALL.md в его корне. Старый каталог сохраните для отката; автоматического обновлятора нет.

Папка данных Companion может храниться отдельно от Streamer.bot. Задайте
`COMPANION_CONFIG_DIR` с абсолютным путём к ней для запускателя и диагностики.
`STREAMERBOT_ROOT` или `--streamerbot-root` задаёт установленный Streamer.bot;
это другой каталог. Если `COMPANION_CONFIG_DIR` не задан, сохраняется прежний
путь `custom/companion/data` внутри Streamer.bot. Отчёт диагностики записывается
в `logs/stream-stack-latest.json` установки Streamer.bot.
