import BannerArtwork from '@maseaaao/artwork/BannerArtwork.vue';
import BrandArtwork from '@maseaaao/artwork/BrandArtwork.vue';
import SceneArtwork from '@maseaaao/artwork/SceneArtwork.vue';
import TwitchPanel from '@maseaaao/artwork/TwitchPanel.vue';
import WallpaperArtwork from '@maseaaao/artwork/WallpaperArtwork.vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, within } from 'storybook/test';
import type { VNode } from 'vue';
import { h } from 'vue';
import '@maseaaao/artwork/styles.css';

const meta: Meta = { title: 'Композиции/Artwork', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;
function scaled(content: () => VNode, width: number, height: number, scale: number) {
  return () => ({
    render: () =>
      h(
        'div',
        {
          style: { width: `${width * scale}px`, height: `${height * scale}px`, overflow: 'hidden' },
        },
        [
          h(
            'div',
            {
              style: {
                width: `${width}px`,
                height: `${height}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              },
            },
            [content()],
          ),
        ],
      ),
  });
}
async function heading(canvasElement: HTMLElement, name: string) {
  await expect(within(canvasElement).getByRole('heading', { name })).toBeVisible();
  await document.fonts.ready;
  await expect(
    [...document.fonts].some(
      (face) => face.family === 'Unbounded' && face.weight === '400' && face.status === 'loaded',
    ),
  ).toBe(true);
}
export const Start: Story = {
  render: scaled(() => h(SceneArtwork, { name: '01-start' }), 2560, 1440, 0.25),
  play: async ({ canvasElement }) => heading(canvasElement, 'начало'),
};
export const PauseVertical: Story = {
  render: scaled(() => h(SceneArtwork, { name: '02-pause-vertical' }), 1080, 1920, 0.3),
  play: async ({ canvasElement }) => heading(canvasElement, 'пауза'),
};
export const Camera: Story = {
  render: scaled(() => h(SceneArtwork, { name: '04-camera-vertical' }), 1080, 1920, 0.3),
};
export const Banner: Story = {
  render: scaled(() => h(BannerArtwork, { platform: 'twitch' }), 1200, 480, 0.5),
  play: async ({ canvasElement }) => heading(canvasElement, 'ЗАЙДИ НА СТРИМ'),
};
export const Panel: Story = {
  render: scaled(() => h(TwitchPanel, { kind: 'specs', title: 'Характеристики' }), 320, 64, 1),
  play: async ({ canvasElement }) => heading(canvasElement, 'Характеристики'),
};
export const OpenGraph: Story = {
  render: scaled(() => h(BrandArtwork, { kind: 'og' }), 1200, 630, 0.5),
  play: async ({ canvasElement }) => heading(canvasElement, 'maseaaao'),
};
export const Subscribe: Story = {
  render: scaled(() => h(BrandArtwork, { kind: 'subscribe' }), 512, 512, 1),
  play: async ({ canvasElement }) => heading(canvasElement, 'Оставайся на связи'),
};
export const Wallpaper: Story = { render: scaled(() => h(WallpaperArtwork), 3840, 2160, 0.15) };
