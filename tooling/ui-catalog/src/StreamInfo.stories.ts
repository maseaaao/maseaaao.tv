import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within } from 'storybook/test';
import { h } from 'vue';
import StreamInfo from 'change-info-streamer-bot/App.vue';
import styles from 'change-info-streamer-bot/ui.css?inline';

const meta: Meta<typeof StreamInfo> = {
  title: 'Экраны/Stream Info',
  component: StreamInfo,
  args: { demo: true },
  parameters: { layout: 'fullscreen' },
  // The product stylesheet is removed on story unmount, not imported globally
  // into every component story. Demo explicitly prevents any live connection.
  render: () => ({ render: () => h('div', [h('style', styles), h(StreamInfo, { demo: true })]) }),
};
export default meta;
type Story = StoryObj<typeof StreamInfo>;
export const Dock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByLabelText('Тема стрима');
    await userEvent.clear(input);
    await userEvent.type(input, 'Проверка полного экрана');
    await expect(canvas.getByText('Есть несохранённые изменения')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Применить изменения' })).toBeEnabled();
  },
};
export const Settings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Настройки' }));
    const dialog = within(canvas.getByRole('dialog'));
    await expect(dialog.getByLabelText('Шаблон Twitch')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Сохранить подключение' })).toBeVisible();
  },
};
