<script setup lang="ts">
/**
 * Поле ввода с лейблом. Подтверждена дублированием в Stream Info
 * (input/textarea + label) и OBS output-stats (поля подключения) —
 * см. docs/ui-renewal-plan.md, этап 5.
 *
 * Валидация значения, маски и autocomplete конкретного поля остаются
 * в потребителе; компонент управляет только разметкой/состоянием поля.
 */
const props = withDefaults(
  defineProps<{
    label: string;
    modelValue: string;
    type?: 'text' | 'password' | 'url' | 'search';
    multiline?: boolean;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    /** Текст ошибки; не задаёт собственную валидацию. */
    error?: string;
    /** Вспомогательный текст под полем, когда нет ошибки. */
    description?: string;
    autocomplete?: string;
  }>(),
  {
    type: 'text',
    placeholder: undefined,
    disabled: false,
    readonly: false,
    error: undefined,
    description: undefined,
    autocomplete: undefined,
  },
);

defineEmits<{ 'update:modelValue': [string] }>();

const inputId = `field-input-${Math.random().toString(36).slice(2, 10)}`;
const descriptionId = `${inputId}-description`;
const hasHelp = Boolean(props.error || props.description);
</script>

<template>
  <div class="field-input">
    <label class="field-input__label" :for="inputId">{{ label }}</label>
    <textarea
      v-if="multiline"
      :id="inputId"
      class="field-input__control"
      :class="{ 'field-input__control--error': Boolean(error) }"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :aria-invalid="Boolean(error) || undefined"
      :aria-describedby="hasHelp ? descriptionId : undefined"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <input
      v-else
      :id="inputId"
      class="field-input__control"
      :class="{ 'field-input__control--error': Boolean(error) }"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :autocomplete="autocomplete"
      :aria-invalid="Boolean(error) || undefined"
      :aria-describedby="hasHelp ? descriptionId : undefined"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p
      v-if="hasHelp"
      :id="descriptionId"
      class="field-input__help"
      :class="{ 'field-input__help--error': Boolean(error) }"
    >
      {{ error || description }}
    </p>
  </div>
</template>

<style scoped>
.field-input {
  display: grid;
  gap: var(--space-2);
  font-size: 14px;
}
.field-input__label {
  color: var(--color-text);
}
.field-input__control {
  width: 100%;
  min-height: var(--control-height);
  padding: var(--space-3);
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-field);
  background: var(--color-field);
  color: var(--color-text);
  font: inherit;
  line-height: 1.5;
}
textarea.field-input__control {
  resize: vertical;
  min-height: 84px;
}
.field-input__control:disabled {
  opacity: 0.7;
}
.field-input__control:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 4px;
}
.field-input__control--error {
  border-color: var(--color-danger);
}
.field-input__help {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-muted);
}
.field-input__help--error {
  color: var(--color-danger);
}
</style>
