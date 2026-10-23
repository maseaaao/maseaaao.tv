import TunaFrame from '@maseaaao/tuna-widget/TunaFrame.vue';
import styles from '@maseaaao/tuna-widget/ui.css?inline';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, within } from 'storybook/test';
import { h } from 'vue';

const meta: Meta<typeof TunaFrame> = {
  title: 'Экраны/Tuna',
  component: TunaFrame,
  args: { title: 'Тестовый трек', artist: 'Тестовый исполнитель', playing: true },
  render: (args) => ({
    render: () =>
      h('div', { style: { width: '540px', maxWidth: '100%', height: '108px' } }, [
        h('style', styles),
        h(TunaFrame, { ...args, style: { opacity: 1 } }),
      ]),
  }),
};
export default meta;
type Story = StoryObj<typeof TunaFrame>;
export const Playing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Тестовый трек')).toBeVisible();
    await expect(canvas.getByRole('main')).toHaveAttribute('data-play', '1');
    await expect(canvasElement.querySelectorAll('img[src]')).toHaveLength(0);
  },
};
export const Paused: Story = { args: { playing: false } };
export const LongMetadata: Story = {
  args: {
    title: 'Очень длинное название трека для проверки узкого источника',
    artist: 'Длинное имя исполнителя',
  },
};
