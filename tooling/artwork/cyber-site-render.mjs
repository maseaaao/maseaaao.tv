import fs from 'node:fs/promises';
import path from 'node:path';
import { renderImage } from './render-image.mjs';
import { buildArtwork } from '../build-artwork.mjs';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const requested = process.argv[2] || 'all';
if (!process.argv.includes('--prepared')) await buildArtwork();
const browser = await launchBrowser({ softwareRendering: true });

async function render(source, target, width, height, format = 'png', scale = 1) {
  return renderImage(browser, {
    source: path.join(root, '.build-cache', source),
    target: path.join(root, target),
    width,
    height,
    format,
    scale,
  });
}

try {
  if (requested === 'all' || requested === 'banners') {
    await render(
      'artwork/banners/twitch.html',
      'artwork/banners/rendered/twitch.jpeg',
      1200,
      480,
      'jpeg',
    );
    await render(
      'artwork/banners/youtube.html',
      'artwork/banners/rendered/youtube.jpeg',
      2560,
      1440,
      'jpeg',
    );
    await render(
      'artwork/banners/offline.html',
      'artwork/banners/rendered/offline.jpeg',
      1920,
      1080,
      'jpeg',
    );
  }
  if (requested === 'all' || requested === 'panels') {
    for (const name of (await fs.readdir(path.join(root, 'artwork/twitch-description'))).filter(
      (name) => name.endsWith('.html'),
    )) {
      await render(
        'artwork/twitch-description/' + name,
        'artwork/twitch-description/rendered/' + name.replace('.html', '.jpeg'),
        320,
        64,
        'jpeg',
      );
    }
  }
  if (requested === 'all' || requested === 'brand') {
    await render(
      'artwork/brand/og.html',
      'artwork/brand/rendered/website/og-image.jpg',
      1200,
      630,
      'jpeg',
    );
    await render(
      'artwork/brand/subscribe.html',
      'artwork/brand/rendered/website/assets/subscribe-512.png',
      512,
      512,
    );
    await render(
      'artwork/brand/background.html',
      'artwork/brand/rendered/website/assets/subscribe-background-ai.png',
      512,
      512,
    );
  }
  if (['all', 'brand', 'favicon'].includes(requested)) {
    await render(
      'artwork/brand/icon.html',
      'artwork/brand/rendered/website/icon-master.png',
      512,
      512,
    );
    const master = await fs.readFile(
      path.join(root, 'artwork/brand/rendered/website/icon-master.png'),
    );
    const favicon = await sharp(master)
      .composite([
        {
          input: await fs.readFile(path.join(root, 'artwork/brand/favicon-mask.svg')),
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();
    const icons = [];
    for (const size of [16, 32, 48]) {
      const data = await sharp(favicon).resize(size).png().toBuffer();
      icons.push({ size, data });
      await fs.writeFile(
        path.join(root, 'artwork/brand/rendered/website/favicon-' + size + 'x' + size + '.png'),
        data,
      );
    }
    await fs.writeFile(
      path.join(root, 'artwork/brand/rendered/website/favicon.ico'),
      await pngToIco(icons.map((icon) => icon.data)),
    );
    if (requested !== 'favicon') {
      for (const [name, size] of [
        ['apple-touch-icon.png', 180],
        ['apple-touch-icon-1024x1024.png', 1024],
        ['android-chrome-512x512.png', 512],
      ]) {
        await sharp(master)
          .resize(size)
          .png()
          .toFile(path.join(root, 'artwork/brand/rendered/website', name));
      }
    }
    await fs.unlink(path.join(root, 'artwork/brand/rendered/website/icon-master.png'));
  }
  if (requested === 'all' || requested === 'wallpapers') {
    await render(
      'artwork/wallpapers/desktop-4k.html',
      'artwork/wallpapers/rendered/desktop-4k.png',
      3840,
      2160,
    );
    await render(
      'artwork/wallpapers/portrait-4k.html',
      'artwork/wallpapers/rendered/portrait-4k.png',
      2160,
      3840,
    );
  }
} finally {
  await browser.close();
}
