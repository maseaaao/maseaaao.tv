# maseaaao — OBS

## Направление
Светлый фон #f4f3ec, синий акцент #1616d9, тёмный текст #20201e.
Unbounded 600 используется для акцентов, Arial — для обычного текста.
Все живые области и прозрачность камеры сохраняются.

- Разрешения: горизонталь **2560×1440**, вертикаль **1080×1920**.
- Шрифт: `python3 scripts/build-web-fonts.py` (нужен fonttools[woff]).
- Сцены: `npm run render:scenes`.
- Остальные ресурсы: `npm run render:cyber-site`.
- `CHROME_BIN` или `CHROME_PATH` задаёт путь к Chrome/Chromium; иначе используется браузер Playwright.
- `CYBER_BACKUP_SCRIPT` при необходимости включает внешнее резервирование перед экспортом. Без него исходники и результаты сохраняются в Git.

## Зарезервированные области под живые источники
Координаты строго соответствуют `OBS/maseaaao.tv/assets/cyber-monolith/obs-layout.json`:

- Горизонтальные статусы:
  - Чат: 1740, 330, 640×640 (непрозрачная HUD-панель)
  - Музыка: 1740, 1010, 640×128 (чистый фон под живой виджет)
  - Доноры: 120, 1200, 1100×165
  - Оповещения / alerts: 120, 824, 1100×366.67 — размер зарезервированной зоны; фактический `boundsHeight` в OBS: 366.5
  - QR: 2180, 1160, 250×250 (встроен оригинальный `maseaaao.tv.png`)
  - Заголовок: слева x=120, y=440 (Unbounded, #f4f3ec, слова: «начало», «пауза», «конец»)

- Вертикальные статусы:
  - Заголовок: слева x=120, y=300
  - Музыка: 120, 540, 720×144
  - Чат: 120, 740, 720×524
  - Доноры: 120, 1320, 720×108
  - Оповещения: 428, 1565, 612×204
  - QR: 120, 1540, 260×260
  - Social: 0, 1856, 1080×64

- Камера, горизонталь (`04-camera-horizontal`):
  - 2560×1440, прозрачная база для камеры на весь экран
  - Только угловая рамка камеры и QR. Полные прямоугольники chat (1740,330,640×640), music (1740,1010,640×128), donors (120,1200,1100×165) прозрачны в idle; постоянных панелей/обводки чата нет. Active backing управляется самими виджетами.

- Камера, вертикаль (`04-camera-vertical`):
  - 1080×1920
  - Верх 0..608 прозрачный под камеру (1080×608)
  - Нижняя зона с y=608 непрозрачная с фоном и панелями
  - Доноры: 120,1344,720×108; музыка сохраняет 720×144.

- Игровая рамка камеры (`cam-frame`):
  - 600×341, прозрачный центр, только угловые фиолетовые визиры

- Вертикальный blank (`00-blank-vertical`):
  - 1080×1920, полностью прозрачный, чтобы не перекрывать игру и камеру.

## Offline corrections / передача parent
- `geometry-corrections.json` содержит только `{sceneUuid,itemId,fieldOld,expectedNew}`: три chat boundsAlignment, один base alert y, шесть bounded donor heights и CAMERA V social item 18. Никаких live вызовов эта сборка не делает.
- `chatFit` отдельно задаёт `boundsAlignment=9` (BOTTOMLEFT = LEFT 1 | BOTTOM 8); `alignment=5` (TOPLEFT = LEFT 1 | TOP 4) **не менять**. `OBS_BOUNDS_SCALE_INNER`, browser viewport 1100×800, позиции, crops и scale сохраняются.
- Проверено по исходникам установленной версии OBS 32.2.2: `libobs/obs-defs.h` (битовые флаги), `libobs/obs-scene.c` (`calculate_bounds_data`, `add_alignment`). Внутренний cast leftover→int оставляет <1 px, а не идеальный дробный bottom-fit.
- H items 6/45: position (1740,330), bounds 640×640, actual fitted top y=504, height=465.454528809, bottom=969.454528809 (panel bottom=970; остаток 0.545471191 px).
- V CAMERA item 14: position (120,704), bounds 720×600, actual fitted top y=780, height=523.636352539, bottom=1303.636352539 (panel bottom=1304; остаток 0.363647461 px).
- Base alerts y=824, bounds 1100×366.5 неизменные: bottom=1190.5, donors top=1200, gap=9.5 px. Logical height=366.67 даёт gap=9.33 px.
- Доноры: parent меняет общий browser source 1000×200→1000×150. Шесть bounded placements: 220→165 (H), 144→108 (V), source/text width без изменений. Семь `OBS_BOUNDS_NONE` placements не требуют transform patch: displayed height сокращается автоматически на 25%, scale/позиции неизменные. Музыку не уменьшать.
- `horizontal.social=[0,0,2560,53.333333333333336]` и `horizontalSocial` задают отдельный shared source 3072×64 при scale=5/6 для CAMERA/SOON/PAUSE/END. Это не запечённый static HUD. Parent владеет HTML/social code: nickname 48 source px, icons 44; disable originals + новые source items в прежнем порядке, не удалять IDs. V source 1080×64 без изменений; только в CAMERA V item18 переносится на y=608 (сразу под камерой), остальные V social остаются прежними.
- Визиры в native exports 20×20 px, stroke 2 px. CAMERA H не содержит idle chat corners: виджет сам владеет fitted active backing.
- Offline fixture — только реальные sanitized transform поля аудита, без URLs/secrets. Тесты не генерируют сообщения, alerts или playback. Реальное естественное сообщение/типографика и live readback остаются задачами parent/widget agent.

- CAMERA V actual camera item1: source1920×1080, scaleY=0.5629629492759705, crop=0, TOPLEFT, position=(0,0); float32 displayed bottom=608. Social item18 сохраняет width1080,height64,scale1,x0 и меняет только y1856→608. Полоса 608..672; chat y704: gap32 px. Camera width1081 — прежняя особенность, не исправляется.
- Full native Chrome screenshots: `rendered/review/*.png` (все 12). PNG и production lossless WEBP имеют pixel parity.

## Предостережение
Для этой корректировки используйте только приведённую выше команду сцен с CYBER_BACKUP_SCRIPT. Не запускайте общий `npm run build:cyber`, legacy `refresh-logo-qr.mjs`, full или banner/Twitch render.
