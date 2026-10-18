# Общий дизайн

brand.css — палитра и типографика всех браузерных интерфейсов. fonts/Unbounded.ttf — исходник, fonts/unbounded-600.woff2 — веб-шрифт с полным набором символов для акцентов. Arial берётся из системы и не распространяется. Лицензия Unbounded — licenses/Unbounded-OFL.txt.

Для регенерации WOFF2: `npm run build:fonts` (Python и fonttools[woff]). Автономные продукты встраивают шрифт и лицензию; сайт публикует WOFF2 локально.
