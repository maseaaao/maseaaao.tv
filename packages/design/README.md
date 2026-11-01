# Общий дизайн

Палитра, типографика и токены движения для браузерных продуктов. Добавьте
`@maseaaao/design` как `workspace:*` зависимость потребителя.

Живые значения и состояния — [maseaaao.tv/ui](https://maseaaao.tv/ui/):
[палитра](https://maseaaao.tv/ui/#palette),
[типографика](https://maseaaao.tv/ui/#type),
[геометрия](https://maseaaao.tv/ui/#geometry),
[движение](https://maseaaao.tv/ui/#motion).

```css
@import '@maseaaao/design/brand.css';
```

`brand.css` подключает токены, общие примитивы движения, Unbounded Variable и
правило `[hidden]`.
Для точечного подключения:

```css
@import '@maseaaao/design/tokens.css';
@import '@maseaaao/design/fonts.css';
```

- `tokens.css` — семантические цвета, размеры и движение.
- `motion.css` — общие keyframes и классы движения; подключается после токенов.
- `fonts.css` — один Unbounded Variable WOFF2 с диапазоном весов 200–900.
  Заголовки и акценты используют `--font-display` с весом 400.
  Только фирменный никнейм использует `--font-nickname` с весом 600
  из `--font-nickname-weight`. Основной текст — `--font-body` (Arial).
- `fonts/*` — каноничный variable WOFF2. Arial берётся из системы и не распространяется.
- `license` — публичный export [Unbounded OFL](licenses/Unbounded-OFL.txt).

Отдельная library build не требуется; копирование/встраивание выполняет сборщик
потребителя. Автономные HTML/CSS встраивают шрифт и лицензию, сайт публикует WOFF2
локально. Не удалять лицензионные уведомления и не встраивать копии шрифта.
Каноничный `fonts/unbounded-variable.woff2` хранится в репозитории; конвертация
при сборке не требуется. [Правила оформления](../../docs/design.md).
