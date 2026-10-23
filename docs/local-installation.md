# Локальная установка

Для новой установки и разделения WSL/Windows использовать [готовые релизы и Windows-обновлятор](windows-releases.md). Он поддерживает один продукт и все последние стабильные выпуски. Подробная таблица первоначального переноса ссылок находится в этой инструкции. Описанные ниже прямые ссылки в checkout отражают прежнее подключение и сохраняются до явной миграции приложений.

> Актуализация 22.10.2026: действующие OBS и Streamer.bot используют прямые пути в maseaaao.tv. [Изменённые ссылки и свежие проверки](resource-path-migration.md), [кандидаты на удаление](cleanup-candidates.md). Команды sync ниже поддерживают совместимые копии, которые текущим прямым ссылкам уже не требуются.

Исходники редактируются в maseaaao.tv. Настройки приложений, аккаунты и рабочие базы сохраняют своё расположение.

## Браузерные ресурсы

Собрать сайт: `bun run build:website`, виджеты: `bun run build:widgets`, Stream Info: `bun run build:stream-info`, Tuna: `bun run build:tuna`.

Проверить план: `bun run sync:local --product stream-info`. Группы: `stream-info`, `tuna`, `widgets`. По умолчанию ожидается соседняя папка Streamer.bot; другую папку OBS указать через `--obs-root`.

Повторить команду с `--apply`: заменяемые файлы сохраняются в Streamer.bot/backup/monorepo-sync-*. Перезагрузить док и браузерные источники. Stream Info сохраняет имя `change-info-streamer-bot.ru.html`; языковых вариантов и дублирующего корневого HTML нет.

Изображения OBS выбирать непосредственно в artwork/scenes/rendered и artwork/logo/rendered. Корневые src/assets и отдельные копии оформления больше не используются. При переносе репозитория обновить пути источников через OBS, сохранив их ID, размеры и расположение.

CSS чата и DonationAlerts размещается через интерфейс соответствующего сервиса; обновление локального файла не заменяет опубликованный CSS. Файлы автономны, шрифт и лицензия встроены.

При уже настроенном CSS override OBS его можно обновлять отдельно через API с `overlay: true`, сохраняя URL и остальные настройки. Шаблон Streamlabs с `{font_size}` / `{message_hide_delay}` напрямую туда не подходит. `prepareObsChatCss` из `tooling/local/obs-provider-css.mjs` берёт прежний размер шрифта из установленного CSS и исключает анимации/keyframes, оставляя жизненный цикл событий провайдеру. Изменение Custom JS в аккаунте Streamlabs — отдельная операция.

## Companion

```powershell
bun run prepare:companion-libs
bun run --filter ./integrations/companion/system-microphone build
bun run --filter ./integrations/companion/voice-control build
bun run --filter ./integrations/companion/system-microphone package
bun run --filter ./integrations/companion/voice-control package
```

Перед установкой сохранить штатный экспорт. Импортировать tgz через менеджер модулей, проверить загруженную версию. SystemMicrophone требует явно выбранный тип входа/выхода; VoiceStream — ID Actions запуска и остановки. Не пересоздавать соединения, кнопки, базу и Junction.

Фактический каталог данных определять по работающему приложению и штатному экспорту, а не по старым инструкциям. Проверка 20.10.2026: процесс Companion 5.1 запущен с `--config-dir` на `%APPDATA%\companion`; файловая система показывает Junction на `Streamer.bot/custom/companion/data` и каталог `v5.0`. Это отличается от записи от 19.10 об обычной папке/v5.1. Диагностика проверила сохранённое состояние через архив самого приложения с WAL: оно совпало с живым экспортом, несмотря на расхождение прямого чтения локальной БД. Не выбирать активную БД только по имени каталога, не синхронизировать базы и не пересоздавать Junction. Обновление модулей выполнять через приложение; подробный барьер и откат: [Companion](../integrations/companion/README.md).

## Streamer.bot

Изменение C# требует отдельного импорта в существующий Action с сохранением ID и проверки Execute Code. HTML не устанавливает C#. DonationAlerts использует приватную глобальную daClientSecret; секреты не включать в Git/HTML. Для Яндекс Музыки проверить путь control.ps1, сохраняя раздельные play/pause.

Диагностика чтения: задать STREAMERBOT_ROOT и запустить `node tooling/local/check-stream-stack.mjs`. Проверка не запускает Actions. Рабочие настройки не редактировать на диске при работающем владельце. Откат ресурсов — из backup, конфигурации и модулей — штатным восстановлением совместимого экспорта.

Результат локальной установки 20.10.2026 и оставшаяся ручная приёмка: [отчёт](local-migration-results.md).

## Переносимый запуск Companion

Исходник запускателя: `integrations/companion/start-companion.ps1`. По умолчанию он использует соседнюю установку `../Streamer.bot/custom/companion/data`; иной корень Streamer.bot задаётся через `-StreamerbotRoot` или `STREAMERBOT_ROOT`. Проверить фактические данные перед запуском. Скрипт использует комплектный Node.js Companion и не запускает второй экземпляр.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File integrations/companion/start-companion.ps1 -OpenAdmin
```

Существующие локальные ярлыки продолжают использовать прежний запускатель в custom/companion; их цель при переносе исходников не менялась. Для его обновления отдельно сохранить резервную копию и проверить путь данных. Полная [карта custom](custom-migration.md) различает рабочие исходники, архив и приватные настройки.
