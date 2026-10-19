# Общие UI-примитивы

`accessibility.css`: класс `.sr-only` сохраняет элемент в accessibility tree и визуально скрывает его. Не использовать на фокусируемых элементах.

Контракт подтверждён двумя потребителями: сайт (`#stream-title`, служебные подписи) и Stream Info (подписи полей и статусов). До переноса обе реализации совпадали побайтово. Утилита не меняет DOM, layout, клавиатурное поведение или бизнес-логику.

## Vue-компоненты (этап 5)

Все компоненты — `<script setup lang="ts">` SFC, стили `scoped`, используют только семантические токены `@maseaaao/design/tokens.css` (запрещены сырые hex/rgb/hsl — проверяется Stylelint). Компоненты не делают сетевых вызовов и не содержат бизнес-логики: обработчики, валидация и API-запросы остаются в продукте-потребителе. Stories и проверки: `tooling/ui-catalog` (`npm run test:ui`, `npm run build:storybook`).

Инвентаризация и обоснование выбора — `docs/ui-renewal-plan.md`, этап 5 ("Инвентаризация кандидатов").

### AppButton (`AppButton.vue`)

Кнопка-действие или ссылка-действие. Потребители: Stream Info (`.button`/`.icon-button`), сайт (`.tile`/кнопки чекера), OBS output-stats (`button`/`button.secondary`).

- Props: `variant?: 'primary' | 'secondary' | 'icon'` (по умолчанию `secondary`), `as?: 'button' | 'a'` (по умолчанию `button`), `href?: string`, `type?: 'button' | 'submit'`, `disabled?: boolean`, `loading?: boolean`, `target?: string`, `rel?: string`, `ariaLabel?: string`.
- Events: `click: [MouseEvent]` (не эмитится при `disabled`/`loading`).
- Slots: `default` — текст действия; `icon` — иконка (обязателен для `variant="icon"`, брендовые SVG остаются в продукте).
- Состояния: `loading` сохраняет подпись и ширину, блокирует повторный клик; `disabled` помечен семантически (`disabled`/`aria-disabled`) и визуально (opacity).
- Ограничение: ровно одно главное действие (`variant="primary"`) на экран — компонент не решает это сам, выбор остаётся за продуктом.

### IconIndicator (`IconIndicator.vue`)

Точка-индикатор статуса с обязательным текстом рядом (design-rules.md: "Статусы включают текст, не только цвет/точку"). Потребители: Stream Info (`.connection i`), OBS output-stats (`#status-dot[data-status]`).

- Props: `status: 'connected' | 'connecting' | 'disconnected' | 'error'` (обязателен), `label: string` (обязателен, без встроенных строк).
- Events/slots: нет.
- Ограничение: не заменяет `LiveStatusBadge` — разная разметка (точка+текст рядом vs пилюля), объединять без третьего подтверждённого потребителя не следует.

### FieldInput (`FieldInput.vue`)

Поле ввода (`input`/`textarea`) с лейблом, описанием и ошибкой. Потребители: Stream Info (`input`/`textarea` + `label`), OBS output-stats (поля подключения).

- Props: `label: string`, `modelValue: string` (оба обязательны), `type?: 'text' | 'password' | 'url' | 'search'` (по умолчанию `text`), `multiline?: boolean`, `placeholder?: string`, `disabled?: boolean`, `readonly?: boolean`, `error?: string`, `description?: string`, `autocomplete?: string`.
- Events: `update:modelValue: [string]`.
- Состояния: `disabled` (opacity), `error` (красная рамка + текст ошибки вместо `description`).
- Ограничение: валидация значения, маски (host/port/password) и `autocomplete` конкретного поля — ответственность продукта; компонент не содержит правил.

### ChipTag (`ChipTag.vue`)

Тег/chip с опциональным удалением. Единственный текущий потребитель — Stream Info (`.chip`, тег-инпут Twitch); второй ожидается на этапе 6 (решение пользователя 19.10.2026, задокументировано в `docs/ui-renewal-plan.md`).

- Props: `label: string` (обязателен), `removable?: boolean` (по умолчанию `false`), `removeLabel?: string` (по умолчанию `'Удалить'`, доступное имя кнопки удаления).
- Events: `remove: []`.
- Ограничение: валидация тега (длина/пробелы/дубли) — бизнес-правило продукта, не компонента.

### NoticeBanner (`NoticeBanner.vue`)

Уведомление info/warning/error/success с заголовком и опциональным описанием/закрытием. Единственный текущий потребитель — Stream Info (`.notice`/`.notice--warning/error/success`); второй ожидается на этапе 6.

- Props: `variant?: 'info' | 'warning' | 'error' | 'success'` (по умолчанию `info`), `title: string` (обязателен), `dismissible?: boolean`, `dismissLabel?: string` (по умолчанию `'Скрыть'`).
- Events: `dismiss: []`.
- Slots: `default` — описание под заголовком.
- Ограничение: не хранит логику появления/очереди уведомлений — продукт решает, когда показывать и сколько держать на экране.

### LiveStatusBadge (`LiveStatusBadge.vue`)

Бейдж-пилюля состояния трансляции с текстом. Единственный текущий потребитель — сайт (`.live-badge`/`.live-badge__dot`); второй ожидается на этапе 6 (Stream Info при переносе `.connection` на общий визуальный язык).

- Props: `status: 'live' | 'offline' | 'disconnected'` (обязателен), `label: string` (обязателен).
- Events/slots: нет.
- Ограничение: не объединяется с `IconIndicator` — разная разметка и контекст использования; решение по объединению возможно только при третьем подтверждённом потребителе.

Карточки с медиа-обложкой (category cover / avatar с fallback) и модальные окна с focus trap — пограничные случаи с одним текущим потребителем (Stream Info); решение по ним отложено до переноса сайта на этапе 6 (см. план).
