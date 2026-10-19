# Локальная установка

Исходники редактируются в maseaaao.tv. Настройки приложений, аккаунты и рабочие базы сохраняют своё расположение.

## Браузерные ресурсы

Собрать сайт: `npm run build:website`, виджеты: `npm run build:widgets`, Stream Info: `npm run build:stream-info`, Tuna: `npm run build:tuna`.

Проверить план: `npm run sync:local -- --product stream-info`. Группы: `stream-info`, `tuna`, `widgets`. По умолчанию ожидается соседняя папка Streamer.bot; другую папку OBS указать через `--obs-root`.

Повторить команду с `--apply`: заменяемые файлы сохраняются в Streamer.bot/backup/monorepo-sync-*. Перезагрузить док и браузерные источники. Stream Info сохраняет имя `change-info-streamer-bot.ru.html`; языковых вариантов и дублирующего корневого HTML нет.

Изображения OBS выбирать непосредственно в artwork/scenes/rendered и artwork/logo/rendered. Корневые src/assets и отдельные копии оформления больше не используются. При переносе репозитория обновить пути источников через OBS, сохранив их ID, размеры и расположение.

CSS чата и DonationAlerts размещается через интерфейс соответствующего сервиса; обновление локального файла не заменяет опубликованный CSS. Файлы автономны, шрифт и лицензия встроены.

## Companion

```powershell
npm run prepare:companion-libs
npm run build --workspace integrations/companion/system-microphone
npm run build --workspace integrations/companion/voice-control
npm run package --workspace integrations/companion/system-microphone
npm run package --workspace integrations/companion/voice-control
```

Перед установкой сохранить штатный экспорт. Импортировать tgz через менеджер модулей, проверить загруженную версию. SystemMicrophone требует явно выбранный тип входа/выхода; VoiceStream — ID Actions запуска и остановки. Не пересоздавать соединения, кнопки, базу и Junction.

Фактический каталог данных определять по работающему приложению и штатному экспорту, а не по старым инструкциям. Проверка 19.10.2026: Companion 5.1 использует `%APPDATA%\companion`, это обычная папка, активная БД — `v5.1/db.sqlite`; соседний `Streamer.bot/custom/companion/data` содержит историческую копию. Не синхронизировать эти базы и не создавать Junction автоматически. Подробный барьер установки и откат: [Companion](../integrations/companion/README.md).

## Streamer.bot

Изменение C# требует отдельного импорта в существующий Action с сохранением ID и проверки Execute Code. HTML не устанавливает C#. DonationAlerts использует приватную глобальную daClientSecret; секреты не включать в Git/HTML. Для Яндекс Музыки проверить путь control.ps1, сохраняя раздельные play/pause.

Диагностика чтения: задать STREAMERBOT_ROOT и запустить `node tooling/local/check-stream-stack.mjs`. Проверка не запускает Actions. Рабочие настройки не редактировать на диске при работающем владельце. Откат ресурсов — из backup, конфигурации и модулей — штатным восстановлением совместимого экспорта.
