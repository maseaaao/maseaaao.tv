import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const AVATAR_DOTWEBP_RE = /^avatar-.*\.webp$/;

const root = path.resolve(import.meta.dirname, '../..');
const logoDir = path.join(root, 'artwork/logo');
const output = path.join(root, 'dist/artwork/logo');
const assets = path.join(root, 'dist/artwork/brand/website/assets');
await fs.mkdir(assets, { recursive: true });
const logo = await fs.readFile(path.join(logoDir, 'logo.png'));
await fs.mkdir(output, { recursive: true });
// Preserve the approved original, including its colour and background.
// Display-driven website variants are derived from the master by the website
// build (@11ty/eleventy-img), not by this script.
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
console.log('Avatar derivatives refreshed; approved logo and QR originals preserved.');
