import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ref } from 'vue';
import FieldInput from './FieldInput.vue';

const meta: Meta<typeof FieldInput> = {
  title: 'Компоненты/FieldInput',
  component: FieldInput,
  args: { label: 'Тема стрима', modelValue: '' },
};
export default meta;
type Story = StoryObj<typeof FieldInput>;

export const Default: Story = { args: { modelValue: 'Проходим новую игру' } };
export const Multiline: Story = {
  args: { multiline: true, label: 'Шаблон заголовка', modelValue: '%subtitle% | !tg !yt !tw' },
};
export const WithDescription: Story = {
  args: {
    modelValue: '',
    placeholder: 'Например, Русский',
    description: 'До 10 тегов, каждый до 25 символов, без пробелов.',
  },
};
export const WithError: Story = {
  args: { modelValue: '', error: 'Заголовок обязателен (1–140 символов).' },
};
export const Disabled: Story = { args: { modelValue: '127.0.0.1', disabled: true } };
export const LongRussianText: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: {
    label: 'Длинное название настройки подключения к локальному серверу Streamer.bot',
    modelValue: '',
    error: 'Это сообщение об ошибке также может быть довольно длинным и должно переноситься',
  },
};
export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Тема стрима');
    await userEvent.type(input, 'Новое значение');
    await expect(input).toHaveValue('Проходим новую игруНовое значение');
  },
  args: { modelValue: 'Проходим новую игру' },
};
export const ReactiveHelp: Story = {
  render: () => ({
    components: { FieldInput },
    setup() {
      const value = ref('');
      const error = ref('');
      return { value, error };
    },
    template: `<div><FieldInput label="Хост" v-model="value" :error="error" autocomplete="off" name="host" />
      <button type="button" @click="error = error ? '' : 'Укажите хост'">Проверить</button></div>`,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Хост');
    await expect(input).toHaveAttribute('name', 'host');
    await userEvent.click(canvas.getByRole('button', { name: 'Проверить' }));
    await expect(input).toHaveAccessibleDescription('Укажите хост');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Проверить' }));
    await expect(input).not.toHaveAttribute('aria-describedby');
  },
};
