# Общий дизайн

Палитра, типографика и токены движения для браузерных продуктов. Добавьте
`@maseaaao/design` как `workspace:*` зависимость потребителя.

```css
@import '@maseaaao/design/brand.css';
```

`brand.css` подключает токены, Unbounded Variable и правило `[hidden]`.
Для точечного подключения:

```css
@import '@maseaaao/design/tokens.css';
@import '@maseaaao/design/fonts.css';
```

- `tokens.css` — семантические цвета, размеры и движение.
- `fonts.css` — один Unbounded Variable WOFF2 с диапазоном весов 200–900.
  Конкретный вес задаётся через `font-weight` в стилях потребителя.
- `fonts/*` — каноничный variable WOFF2. Arial берётся из системы и не распространяется.
- `license` — публичный export [Unbounded OFL](licenses/Unbounded-OFL.txt).

Отдельная library build не требуется; копирование/встраивание выполняет сборщик
потребителя. Автономные HTML/CSS встраивают шрифт и лицензию, сайт публикует WOFF2
локально. Не удалять лицензионные уведомления и не встраивать копии шрифта.
Каноничный `fonts/unbounded-variable.woff2` хранится в репозитории; конвертация
при сборке не требуется. [Правила оформления](../../docs/design.md).
