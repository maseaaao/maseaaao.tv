# Общий дизайн

Палитра, типографика и токены движения для браузерных продуктов. Добавьте
`@maseaaao/design` как `workspace:*` зависимость потребителя.

```css
@import '@maseaaao/design/brand.css';
```

`brand.css` подключает токены, Unbounded 400 и правило `[hidden]`.
Для точечного подключения:

```css
@import '@maseaaao/design/tokens.css';
@import '@maseaaao/design/fonts-400.css';
```

- `tokens.css` — семантические цвета, размеры и движение.
- `fonts-400.css` / `fonts-600.css` — явный выбор начертания Unbounded.
  Совместимый `fonts.css` подключает **600**, не оба веса.
- `fonts/*` — исходный TTF и WOFF2. Arial берётся из системы и не распространяется.
- `license` — публичный export [Unbounded OFL](licenses/Unbounded-OFL.txt).

Отдельная library build не требуется; копирование/встраивание выполняет сборщик
потребителя. Автономные HTML/CSS встраивают шрифт и лицензию, сайт публикует WOFF2
локально. Не удалять лицензионные уведомления и не включать лишние начертания.

Пересборка WOFF2 из корня: `bun run build:fonts`; нужны Python и зависимости
`tooling/artwork/requirements-fonts.txt`. [Правила оформления](../../docs/design.md).
