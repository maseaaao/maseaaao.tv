import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import SceneArtwork from './components/SceneArtwork.vue';
import BannerArtwork from './components/BannerArtwork.vue';
import OfflineBannerArtwork from './components/OfflineBannerArtwork.vue';
import TwitchPanel from './components/TwitchPanel.vue';
import BrandArtwork from './components/BrandArtwork.vue';
import WallpaperArtwork from './components/WallpaperArtwork.vue';
import LogoArtwork from './components/LogoArtwork.vue';
import layout from './scenes/layout.json';
import './styles.css';

const panels = [
  ['01-about', 'about', 'Обо мне'],
  ['02-rules', 'rules', 'Правила'],
  ['03-donate', 'donate', 'Донат'],
  ['04-devices', 'devices', 'Устройства'],
  ['05-specs', 'specs', 'Характеристики'],
];
export function renderPage(name) {
  let node;
  const scene = layout.files.find((file) => name === `scenes/${file.file}`);
  if (scene) node = h(SceneArtwork, { name: scene.name });
  for (const platform of ['twitch', 'youtube'])
    if (name === `banners/${platform}.html`) node = h(BannerArtwork, { platform });
  if (name === 'banners/offline.html') node = h(OfflineBannerArtwork);
  for (const [file, kind, title] of panels)
    if (name === `twitch-description/${file}.html`) node = h(TwitchPanel, { kind, title });
  for (const kind of ['og', 'subscribe', 'background', 'icon'])
    if (name === `brand/${kind}.html`) node = h(BrandArtwork, { kind });
  if (/^wallpapers\/(desktop|portrait)-4k\.html$/.test(name)) node = h(WallpaperArtwork);
  if (name === 'logo/maseaaao.html') node = h(LogoArtwork);
  if (!node) throw Error(`Unknown artwork page: ${name}`);
  return renderToString(createSSRApp({ render: () => node }));
}
