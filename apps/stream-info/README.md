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
`$s` подставляет поле «Название». Общая кнопка «Применить изменения»
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

## Цель на фолловеров

`streamerbot/creator-goal.cs` — отдельное действие Streamer.bot `Creator Goal`
(Execute Code). Оно читает активную цель через Creator Goals API и пишет её
в persistent global `twitchGoal`:

```json
{ "type": "follower", "current": 18, "target": 20, "description": "…", "updated": 1760000000 }
```

1. Импортируйте C# как действие `Creator Goal` (сохраняйте существующие ID).
2. Нужен scope `channel:read:goals` у broadcaster-токена. Если Helix отвечает
   401 — переподключите Twitch в Streamer.bot.
3. Виджет соцполосы сам вызывает действие по WebSocket при загрузке и раз в
   30 секунд, затем читает `twitchGoal` через `GetGlobals`.

Нет активной цели — global пустой, виджеты скрывают счётчик. Цель и её текущее
значение берутся только из Twitch; в виджете ничего не хардкодится.
