import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { generateQrWithLogo } from './generate-qr-with-logo.ts';
import { logoMasterPng, readToken } from './logo-master.ts';

const AVATAR_DOTWEBP_RE = /^avatar-.*\.webp$/;
const QR_TEXT = 'https://maseaaao.tv';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'dist/artwork/logo');
const assets = path.join(root, 'dist/artwork/brand/website/assets');
const websiteQr = path.join(root, 'apps/website/public/assets/maseaaao.tv.png');
await fs.mkdir(assets, { recursive: true });
await fs.mkdir(output, { recursive: true });
// Векторный мастер — источник всех растров аватара; цвета берутся из палитры.
const logo = await logoMasterPng(1024);
// PNG рядом с мастером пересобирается тем же прогоном: HTML-витрины и обои
// читают его, поэтому цвет в них тоже следует палитре.
await fs.writeFile(path.join(root, 'artwork/logo/logo.png'), await logoMasterPng(1254));
// biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
for (const name of (await fs.readdir(assets)).filter((nameLocal) =>
  AVATAR_DOTWEBP_RE.test(nameLocal),
)) {
  await fs.rm(path.join(assets, name));
}
await sharp(logo).resize(512, 512).png().toFile(path.join(assets, 'avatar-master.png'));
for (const name of ['maseaaao']) {
  // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
  const image = await sharp(logo)
    .resize(1920, 540, { background: { alpha: 0, b: 19, g: 17, r: 17 }, fit: 'contain' })
    .webp({ lossless: true })
    .toBuffer();
  await fs.writeFile(path.join(output, name + '.webp'), image);
}
await sharp(logo).resize(1024, 1024).png().toFile(path.join(output, 'avatar-1024.png'));
await sharp(logo).resize(256, 256).png().toFile(path.join(output, 'avatar-256.png'));
// Circle crop: edges cut off, transparent outside the circle.
const circleMask = (size: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
for (const size of [1024, 512, 256]) {
  // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
  const base = await sharp(logo)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const circle = await sharp(base)
    .composite([{ blend: 'dest-in', input: circleMask(size) }])
    .png()
    .toBuffer();
  await fs.writeFile(path.join(output, `avatar-circle-${size}.png`), circle);
  if (size === 1024) {
    await fs.writeFile(
      path.join(output, 'logo-circle.webp'),
      await sharp(circle).webp({ lossless: true }).toBuffer(),
    );
  }
}
// QR со знаком в центре: цвета и плитка из палитры, читаемость проверяет генератор.
const qr = await generateQrWithLogo({
  color: { dark: await readToken('color-text'), light: await readToken('color-surface') },
  logo: await logoMasterPng(256),
  text: QR_TEXT,
  tile: { fill: await readToken('color-field'), stroke: await readToken('color-accent-soft') },
  width: 800,
});
await fs.writeFile(path.join(output, 'qr.png'), qr.buffer);
await fs.writeFile(websiteQr, qr.buffer);
console.log(
  `Avatar derivatives refreshed from artwork/logo/mark.svg; QR ${qr.width}px written for ${qr.decoded}.`,
);
