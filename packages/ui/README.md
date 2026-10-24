# Общие UI-компоненты

Классовые стили без фреймворка и сетевых запросов. Добавьте `@maseaaao/ui` и
`@maseaaao/design` как `workspace:*` зависимости потребителя; импортируйте
только через публичные exports, а не файлы напрямую.

## API

- [components.css](components.css): классовые эквиваленты прежних
  компонентов — `.app-button` (`primary`, `secondary`, `icon`,
  `app-button--loading`), `.field-input`, `.icon-indicator`
  (`data-status="connected|connecting|disconnected|error"`),
  `.live-status-badge` (`live-status-badge--live|offline|notConnected`),
  `.chip-tag`, `.notice`, отступы и состояния нажатия. Loading сохраняет
  подпись и блокирует действие; disabled/loading ссылка не получает `href`;
  разметку и доступные подписи собирает потребитель.
- [accessibility.css](accessibility.css): уважение `prefers-reduced-motion`,
  стили фокуса и `sr-only`.

Референс по использованию — `apps/stream-info/src/styles.css` и
`apps/stream-info/src/render.ts`.
