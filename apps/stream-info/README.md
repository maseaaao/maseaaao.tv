# Stream Info

Автономный русский док OBS: название, категория, теги и шаблоны Twitch.
Соединяется с WebSocket Streamer.bot; OAuth остаётся в Streamer.bot.

1. Из корня выполните `bun run build:stream-info`.
2. Подключите `dist/stream-info/change-info-streamer-bot.ru.html` из корня репозитория как док OBS.
3. Включите WebSocket Streamer.bot и укажите подключение в настройках дока.
   Импортируйте `dist/stream-info/streamerbot-import.txt`, если API отсутствует или изменился C#;
   Action `STREAM INFO | API` должен быть включён. Сохраняйте существующие ID.

Для просмотра без соединения добавьте `?demo=1`. Шрифт и стили встроены.
Пароль сохраняется только с флажком «Запомнить пароль». Черновик шаблона живёт
в sessionStorage вкладки; сохранённые шаблоны — в постоянных переменных Streamer.bot.
`%subtitle%` подставляет поле «Название». Общая кнопка «Применить изменения»
сохраняет метаданные и изменённый шаблон; ошибка оставляет черновики.

Для игрового пресета создайте `PRESET | Название игры` в группе `STREAM INFO`:
задайте persistent globals `stream_info.template.twitch`, `stream_info.template.subtitle`,
`stream_info.preset.twitchCategoryId`, `stream_info.preset.twitchTagsJson` и вызовите
API с `command=applyPreset`. Пустые категория и теги не меняют текущие значения.

## Разработка

`src/render.ts` создаёт DOM, `src/controller.ts` управляет состоянием и транспортом.
Каждый `initDock()` возвращает независимый док с `dispose()` для освобождения ресурсов.
Кеш API — 5 секунд со сбросом после записи.

Из корня: `bun run test:stream-info` (только JS/TS, без .NET).
C#-тесты запускайте отдельно через `bun run test:csharp` (нужен .NET SDK 8).
Они не входят в общий `bun run test` и обязательные проверки CI.

[Подключение](../../docs/local-installation.md).
