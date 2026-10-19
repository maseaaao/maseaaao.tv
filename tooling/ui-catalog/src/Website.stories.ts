import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, within } from 'storybook/test';
import { h } from 'vue';
import HomePage from '@maseaaao/website/HomePage.vue';
import CheckerPage from '@maseaaao/website/CheckerPage.vue';
import DocsPage from '@maseaaao/website/DocsPage.vue';
import ToolsPage from '@maseaaao/website/ToolsPage.vue';
import StreamInfoPage from '@maseaaao/website/StreamInfoPage.vue';
import TunaPage from '@maseaaao/website/TunaPage.vue';
import styles from '@maseaaao/website/ui.css?inline';

const meta: Meta<typeof HomePage> = {
  title: 'Экраны/Сайт',
  component: HomePage,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof HomePage>;
// Product behavior is verified on the built HTML with routed Twitch/iframe fixtures.
// Catalog entries show the actual compiled compositions without remote media.
export const Home: Story = {
  render: () => ({ render: () => h('div', [h('style', styles), h(HomePage, { preview: true })]) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'maseaaao' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: /Зайди на стрим/ })).toHaveAttribute(
      'href',
      'https://www.twitch.tv/maseaaao',
    );
    await expect(canvas.getByRole('link', { name: /Сообщество ЛОББИ/ })).toBeVisible();
    await expect(canvasElement.querySelector('iframe[src]')).toBeNull();
  },
};
export const Checker: Story = {
  render: () => ({
    render: () => h('div', { class: 'checker' }, [h('style', styles), h(CheckerPage)]),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Добавить все' })).toBeVisible();
    await expect(canvas.getAllByRole('status')).toHaveLength(2);
    await expect(canvasElement.querySelector('iframe')).toBeNull();
  },
};
export const Documentation: Story = {
  render: () => ({ render: () => h('div', { class: 'docs' }, [h('style', styles), h(DocsPage)]) }),
};
export const Tools: Story = {
  render: () => ({ render: () => h('div', { class: 'docs' }, [h('style', styles), h(ToolsPage)]) }),
};
export const StreamInfo: Story = {
  render: () => ({
    render: () => h('div', { class: 'docs' }, [h('style', styles), h(StreamInfoPage)]),
  }),
};
export const Tuna: Story = {
  render: () => ({ render: () => h('div', { class: 'docs' }, [h('style', styles), h(TunaPage)]) }),
};
