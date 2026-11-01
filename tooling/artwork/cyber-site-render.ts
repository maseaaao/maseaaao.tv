import fs from 'node:fs/promises';
import path from 'node:path';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';
import { buildArtwork } from '../build-artwork.ts';
import { launchBrowser } from './browser.ts';
import { logoMasterPng } from './logo-master.ts';
import { renderImage } from './render-image.ts';

const ARTWORK_RE_2 = /^artwork\//;

const root = path.resolve(import.meta.dirname, '../..');
const requested = process.argv[2] || 'all';
if (!process.argv.includes('--prepared')) {
  await buildArtwork();
}
const browser = await launchBrowser({ softwareRendering: true });

function render(
  source: string,
  target: string,
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' = 'png',
  scale = 1,
) {
  return renderImage(browser, {
    format,
    height,
    scale,
    source: path.join(root, 'dist/artwork/html', source.replace(ARTWORK_RE_2, '')),
    target: path.join(root, 'dist', target),
    width,
  });
}

try {
  if (requested === 'all' || requested === 'banners') {
    await render('artwork/banners/twitch.html', 'artwork/banners/twitch.jpeg', 1200, 480, 'jpeg');
    await render(
      'artwork/banners/youtube.html',
      'artwork/banners/youtube.jpeg',
      2560,
      1440,
      'jpeg',
    );
    await render(
      'artwork/banners/offline.html',
      'artwork/banners/offline.jpeg',
      1920,
      1080,
      'jpeg',
    );
  }
  if (requested === 'all' || requested === 'panels') {
    // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
    for (const name of (await fs.readdir(path.join(root, 'artwork/twitch-description'))).filter(
      (nameLocal) => nameLocal.endsWith('.html'),
    )) {
      await render(
        'artwork/twitch-description/' + name,
        'artwork/twitch-description/' + name.replace('.html', '.png'),
        640,
        128,
        'png',
      );
    }
  }
  if (requested === 'all' || requested === 'brand') {
    await render('artwork/brand/og.html', 'artwork/brand/website/og-image.jpg', 1200, 630, 'jpeg');
    // Ручной ассет: карточку «Оставайся на связи» владелец забирает из dist для промо
    // (например, в Телеграме). Страницы сайта на неё не ссылаются — не считать неиспользуемой.
    await render(
      'artwork/brand/subscribe.html',
      'artwork/brand/website/assets/subscribe-512.png',
      512,
      512,
    );
  }
  if (['all', 'brand', 'favicon'].includes(requested)) {
    // Знак для иконок собирается из векторного мастера, цвета — из палитры.
    const iconMaster = path.join(root, 'dist/artwork/brand/website/icon-master.png');
    await fs.writeFile(iconMaster, await logoMasterPng(512));
    const master = await fs.readFile(iconMaster);
    const favicon = await sharp(master)
      .composite([
        {
          blend: 'dest-in',
          // Скругление (12.5% стороны) нужно только favicon: iOS и Android накладывают
          // свою маску сами, поэтому apple-touch-icon и android-chrome остаются квадратными.
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="white"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
    const icons: { data: Buffer; size: number }[] = [];
    for (const size of [16, 32, 48]) {
      // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
      const data = await sharp(favicon).resize(size).png().toBuffer();
      icons.push({ data, size });
      await fs.writeFile(
        path.join(root, 'dist/artwork/brand/website/favicon-' + size + 'x' + size + '.png'),
        data,
      );
    }
    await fs.writeFile(
      path.join(root, 'dist/artwork/brand/website/favicon.ico'),
      await pngToIco(icons.map((icon) => icon.data)),
    );
    if (requested !== 'favicon') {
      for (const [name, size] of [
        ['apple-touch-icon.png', 180],
        ['apple-touch-icon-1024x1024.png', 1024],
        ['android-chrome-512x512.png', 512],
      ] as const) {
        // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
        await sharp(master)
          .resize(size)
          .png()
          .toFile(path.join(root, 'dist/artwork/brand/website', name));
      }
    }
    await fs.unlink(path.join(root, 'dist/artwork/brand/website/icon-master.png'));
  }
  if (requested === 'all' || requested === 'wallpapers') {
    await render(
      'artwork/wallpapers/desktop-4k.html',
      'artwork/wallpapers/desktop-4k.png',
      3840,
      2160,
    );
    await render(
      'artwork/wallpapers/portrait-4k.html',
      'artwork/wallpapers/portrait-4k.png',
      2160,
      3840,
    );
  }
} finally {
  await browser.close();
}
