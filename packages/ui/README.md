# Общие UI-компоненты

Vue SFC без сетевых запросов и бизнес-логики. Добавьте `@maseaaao/ui` и
`@maseaaao/design` как `workspace:*` зависимости потребителя; импортируйте
компоненты через публичные exports, а не относительные пути между пакетами.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AppButton from '@maseaaao/ui/AppButton.vue';
import FieldInput from '@maseaaao/ui/FieldInput.vue';
import '@maseaaao/design/brand.css';

const title = ref('');
</script>

<template>
  <form @submit.prevent>
    <FieldInput v-model="title" label="Название" />
    <AppButton type="submit" variant="primary">Сохранить</AppButton>
  </form>
</template>
```

## API

Типы props, события и slots определены в исходниках:

- [AppButton](src/AppButton.vue): `variant` (`primary`, `secondary`, `icon`),
  `as` (`button`, `a`), `href`, `type`, `disabled`, `loading`, `inverted`,
  `pressEffect`, `target`, `rel`, `ariaLabel`. Событие `click`, slots `default`
  и `icon`. Loading сохраняет подпись и блокирует действие; disabled/loading
  ссылка не получает `href`. Иконке без текста нужна доступная подпись.
- [FieldInput](src/FieldInput.vue): обязательные `label` и строковый `modelValue`,
  событие `update:modelValue` для `v-model`. Поддерживает `id`, `type` (включая
  `number`), `multiline`, `placeholder`, `disabled`, `readonly`, `error`,
  `description`, `autocomplete`. Даже числовое значение остаётся строкой;
  преобразование и валидация принадлежат приложению. Атрибуты передаются контролу.
- [IconIndicator](src/IconIndicator.vue): обязательные `status` (`connected`,
  `connecting`, `disconnected`, `error`) и `label`; опциональные `inverted`,
  `dotId`, `labelId`. Точка с текстом состояния подключения.
- [LiveStatusBadge](src/LiveStatusBadge.vue): обязательные `status` (`live`,
  `offline`, `disconnected`) и `label`. Статус эфира задаёт потребитель;
  компонент не запрашивает Twitch и не предполагает, что эфир идёт.

`@maseaaao/ui/accessibility.css` предоставляет `.sr-only`: визуально скрывает
текст, сохраняя его для accessibility tree. Не применять к фокусируемым элементам.

Стили используют общие токены; правила оформления — [дизайн](../../docs/design.md).
Примеры состояний — соседние `*.stories.ts`; Storybook и тесты компонентов —
[tooling/ui-catalog](../../tooling/ui-catalog). Команды из корня:
`bun run build:storybook`, `bun run test:ui`.
