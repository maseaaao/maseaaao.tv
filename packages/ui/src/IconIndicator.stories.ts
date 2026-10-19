import type { Meta, StoryObj } from '@storybook/vue3-vite';
import IconIndicator from './IconIndicator.vue';

const meta: Meta<typeof IconIndicator> = {
  title: 'Компоненты/IconIndicator',
  component: IconIndicator,
};
export default meta;
type Story = StoryObj<typeof IconIndicator>;

export const Connected: Story = { args: { status: 'connected', label: 'Подключено' } };
export const Connecting: Story = { args: { status: 'connecting', label: 'Подключение…' } };
export const Disconnected: Story = { args: { status: 'disconnected', label: 'Нет подключения' } };
export const ErrorState: Story = {
  args: { status: 'error', label: 'Ошибка авторизации' },
};
export const LongRussianText: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: {
    status: 'connecting',
    label: 'Подключение к Streamer.bot на 127.0.0.1:8080 — проверьте пароль',
  },
};
