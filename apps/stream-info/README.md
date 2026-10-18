# Stream Info для Streamer.bot

Автономный русский док OBS для Twitch: название, категория, теги, шаблон и игровые пресеты. Подключается к локальному WebSocket Streamer.bot; OAuth-данные остаются внутри приложения.

Собрать из корня репозитория: `npm run build:stream-info`. Готовый файл — `dist/change-info-streamer-bot.ru.html` в этом приложении. Подключить его через OBS Dock. Для просмотра без соединения добавить `?demo=1`.

Включить WebSocket Streamer.bot, импортировать streamerbot-import.txt при изменении C# и проверить включённый STREAM INFO | API. Имена и ID API сохраняются. Параметры подключения и черновики остаются в браузере, шаблоны — в постоянных переменных Streamer.bot.

Для пресета создать Action PRESET | Название игры в группе STREAM INFO. Он задаёт persistent globals `stream_info.template.twitch`, `stream_info.template.subtitle`, `stream_info.preset.twitchCategoryId`, `stream_info.preset.twitchTagsJson`, затем вызывает API с command=applyPreset. Пустые категория/теги не меняют соответствующие поля.

Проверки из корня: `npm run check:stream-info`, `npm run test:stream-info`. Кеш состояния — 5 секунд со сбросом после записи. Поиск категорий ранжирует результаты, сохраняет выбор по ID и отличает ошибку от пустой выдачи.

Шрифты — встроенный Unbounded и системный Arial. [Установка](../../docs/local-installation.md), [выпуски](../../docs/releasing.md), [лицензия](LICENSE).
