# Общий дизайн

brand.css — палитра и типографика всех браузерных интерфейсов. fonts/Unbounded.ttf — исходник, fonts/unbounded-600.woff2 — веб-шрифт с полным набором символов для акцентов. Arial берётся из системы и не распространяется. Лицензия Unbounded — licenses/Unbounded-OFL.txt.

Для регенерации WOFF2: `npm run build:fonts` (Python и fonttools[woff]). Автономные продукты встраивают шрифт и лицензию; сайт публикует WOFF2 локально.

Публичные entrypoints: `@maseaaao/design/brand.css` (совместимый агрегатор), `fonts.css`, `tokens.css`, `fonts/*`, `license`. Импортировать пакет через workspace dependency. Исходники font-face и токенов не требуют отдельной library build. Копирование и embedding выполняет сборщик потребителя.

`tokens.css` также включает `motion.css`: длительности и кривые интерфейсного движения, с обнулением при reduced-motion. [Сценарии и ограничения](../../docs/motion.md). Тайминги эфирных виджетов остаются в их продуктах.
