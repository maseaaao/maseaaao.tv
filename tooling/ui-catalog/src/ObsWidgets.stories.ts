import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, within } from 'storybook/test';
import { h } from 'vue';
import SocialStrip from '@maseaaao/obs-widgets/SocialStrip.vue';
import OutputStats from '@maseaaao/obs-widgets/OutputStats.vue';
import social from '@maseaaao/obs-widgets/social.css?inline';
import stats from '@maseaaao/obs-widgets/stats.css?inline';

const meta: Meta<typeof SocialStrip> = {
  title: 'Экраны/OBS',
  component: SocialStrip,
};
export default meta;
type Story = StoryObj<typeof SocialStrip>;
export const Social: Story = {
  render: () => ({
    render: () =>
      h('div', { style: { width: '540px', maxWidth: '100%', height: '90px' } }, [
        h('style', social),
        h(SocialStrip),
      ]),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('img', { name: 'Twitch, YouTube, Telegram, Instagram, TikTok' }),
    ).toBeVisible();
    await expect(canvasElement.querySelectorAll('.logo')).toHaveLength(5);
    await expect(canvas.getByText('maseaaao')).toBeVisible();
  },
};
export const Statistics: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => ({ render: () => h('div', [h('style', stats), h(OutputStats)]) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Статистика выходов' })).toBeVisible();
    await expect(canvas.getByLabelText('Адрес OBS WebSocket')).toHaveValue('ws://localhost:4455/');
    await expect(canvas.getByRole('button', { name: 'ПОДКЛЮЧИТЬ' })).toBeVisible();
    await expect(canvas.getAllByRole('columnheader')).toHaveLength(8);
  },
};
