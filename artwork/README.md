# Artwork

HTML-файлы в каталогах сцен, баннеров, Twitch-панелей, brand, логотипа и обоев — авторские исходники композиций. Vite/singlefile собирает 27 автономных HTML в `.build-cache/artwork` без SSR и собственного шаблонизатора. Общие стили находятся в `styles.css` и CSS соответствующих композиций; палитра и шрифт импортируются из `@maseaaao/design`.

`bun run build:artwork` проверяет утверждённый QR и готовит HTML. Затем `bun run render:scenes`, `render:banners`, `render:twitch-description`, `render:wallpapers` и `brand:assets` создают нужные изображения общим `renderImage`. Каждая отдельная команда подготавливает HTML; если HTML уже подготовлен, можно вызвать соответствующий скрипт с `--prepared`. Рендер проверяет реальные начертания шрифта, загрузку локальных изображений и размеры, блокирует сеть. Источники при генерации не меняются.

`scenes/layout.json` — геометрия 12 сцен: все live-зоны, камера, identity/header/title, canvas и путь каждого WEBP. Координаты сохранены; существующее наложение music/donors в vertical-camera не исправляется визуальной миграцией. `scenes/SETUP.md` описывает установку. OBS читает готовые изображения по прежним путям.

`brand/rendered/website` — единственный владелец генерируемых изображений сайта: аватары, OG, subscribe, favicon и apple/android icons. `build:website` копирует их с прежними URL, отклоняет коллизии с public/страницами/bundles; `check:repository` проверяет побайтовую актуальность. Storybook читает те же файлы. В public остаются защищённые документы и QR.

`logo/logo.png` и `apps/website/public/assets/maseaaao.tv.png` — защищённые оригиналы. Утверждённые avatar WEBP перенесены побайтово. `render:logo` обновляет только производные аватара, QR не генерирует. Оптимизация пропускает оба защищённых оригинала и по умолчанию обходит только каталоги результатов. Сборка и рендер не устанавливают оформление в OBS и не публикуют сайт.

Проверки: `tests/artwork-artifacts.test.mjs`, `cyber-scenes`, `cyber-scene-corrections`, `banner-dimensions`, `operational-pages`, `render-image`, `source-isolation`; автономные композиции проверяются из результатов Vite. Целевая Windows 11/OBS/Chrome приёмка отмечается отдельно от macOS-разработки.
