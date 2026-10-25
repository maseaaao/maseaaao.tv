# Общие UI-компоненты

Классовые стили без фреймворка и сетевых запросов. Добавьте `@maseaaao/ui` и
`@maseaaao/design` как `workspace:*` зависимости потребителя; импортируйте
только через публичные exports, а не файлы напрямую.

Живые примеры всех общих компонентов и их состояний —
[UI Gallery](../../apps/ui-gallery/README.md), запуск из корня: `bun run dev:ui`.

## API

- [components.css](components.css): классовые эквиваленты прежних
  компонентов — `.app-button` (`primary`, `secondary`, `icon`,
  `app-button--loading`), `.field-input`, `.icon-indicator`
  (`data-status="connected|connecting|disconnected|error"`),
  `.live-status-badge` (базовый offline, `live-status-badge--live|disconnected`),
  отступы и состояния нажатия. Loading сохраняет
  подпись и блокирует действие; disabled/loading ссылка не получает `href`;
  разметку и доступные подписи собирает потребитель.
- [accessibility.css](accessibility.css): уважение `prefers-reduced-motion`,
  стили фокуса и `sr-only`.

Референс по использованию — `apps/stream-info/src/styles.css` и
`apps/stream-info/src/render.ts`.
