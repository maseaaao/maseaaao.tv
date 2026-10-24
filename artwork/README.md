# Artwork

HTML-файлы в каталогах сцен, баннеров, Twitch-панелей, brand, логотипа и обоев — авторские исходники композиций. Vite/singlefile собирает 27 автономных HTML в `.build-cache/artwork` без SSR и собственного шаблонизатора. Общие стили находятся в `styles.css` и CSS соответствующих композиций; палитра и шрифт импортируются из `@maseaaao/design`.

`bun run build:artwork` проверяет утверждённый QR и готовит HTML. `bun run render:scenes` создаёт сцены, `bun run render:logo` — производные аватара. Остальные изображения создаёт одна команда `bun run render:artwork <группа>`: `banners`, `panels` (Twitch-панели), `wallpapers`, `brand` или `favicon`; без группы она создаёт все эти изображения. Каждая команда рендера сцен и artwork подготавливает HTML; если HTML уже подготовлен, можно передать `--prepared` после группы. Рендер использует общий `renderImage`, проверяет реальные начертания шрифта, загрузку локальных изображений и размеры, блокирует сеть. Источники при генерации не меняются.

Для полного экспорта используйте `bun run verify:artwork`: логотип, одна подготовка HTML, сцены и остальные изображения. Чтобы затем пересобрать продукты, выполните `bun run build:all`.

`scenes/layout.json` — геометрия 12 сцен: все live-зоны, камера, identity/header/title, canvas и путь каждого WEBP. Координаты сохранены; существующее наложение music/donors в vertical-camera не исправляется визуальной миграцией. `scenes/SETUP.md` описывает установку. OBS читает готовые изображения по прежним путям.

`brand/rendered/website` — единственный владелец генерируемых изображений сайта: аватары, OG, subscribe, favicon и apple/android icons. `build:website` копирует их с прежними URL, отклоняет коллизии с public/страницами/bundles; `check:repository` проверяет побайтовую актуальность. Storybook читает те же файлы. В public остаются защищённые документы и QR.

`logo/logo.png` и `apps/website/public/assets/maseaaao.tv.png` — защищённые оригиналы. Утверждённые avatar WEBP перенесены побайтово. `render:logo` обновляет только производные аватара, QR не генерирует. Оптимизация пропускает оба защищённых оригинала и по умолчанию обходит только каталоги результатов. Сборка и рендер не устанавливают оформление в OBS и не публикуют сайт.

Проверки: `tests/artwork-artifacts.test.mjs`, `cyber-scenes`, `cyber-scene-corrections`, `banner-dimensions`, `operational-pages`, `render-image`, `source-isolation`; автономные композиции проверяются из результатов Vite. Целевая Windows 11/OBS/Chrome приёмка отмечается отдельно от macOS-разработки.
