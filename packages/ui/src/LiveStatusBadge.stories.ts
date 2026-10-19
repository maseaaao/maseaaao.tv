import type { Meta, StoryObj } from '@storybook/vue3-vite';
import LiveStatusBadge from './LiveStatusBadge.vue';

const meta: Meta<typeof LiveStatusBadge> = {
  title: 'Компоненты/LiveStatusBadge',
  component: LiveStatusBadge,
};
export default meta;
type Story = StoryObj<typeof LiveStatusBadge>;

export const Live: Story = { args: { status: 'live', label: 'LIVE' } };
export const Offline: Story = { args: { status: 'offline', label: 'Не в эфире' } };
export const Disconnected: Story = { args: { status: 'disconnected', label: 'Нет связи' } };
export const LongRussianText: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: { status: 'offline', label: 'Сейчас не в эфире, записи доступны на Twitch' },
};
