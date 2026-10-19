import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../..');
const logoDir = path.join(root, 'artwork/logo');
const assets = path.join(root, 'artwork/brand/rendered/website/assets');
await fs.mkdir(assets, { recursive: true });
const logo = await fs.readFile(path.join(logoDir, 'logo.png'));
await fs.mkdir(path.join(logoDir, 'rendered'), { recursive: true });
// Preserve the approved original, including its colour and background.
for (const size of [64, 96, 128, 192, 288])
  await sharp(logo)
    .resize(size, size)
    .webp({ quality: 88, effort: 6 })
    .toFile(path.join(assets, `avatar-${size}.webp`));
for (const name of ['maseaaao']) {
  const image = await sharp(logo)
    .resize(1920, 540, { fit: 'contain', background: { r: 17, g: 17, b: 19, alpha: 0 } })
    .webp({ lossless: true })
    .toBuffer();
  await fs.writeFile(path.join(logoDir, 'rendered', name + '.webp'), image);
}
await sharp(logo)
  .resize(1024, 1024)
  .png()
  .toFile(path.join(logoDir, 'rendered', 'avatar-1024.png'));
await sharp(logo)
  .resize(256, 256)
  .png()
  .toFile(path.join(logoDir, 'rendered', 'avatar-256.png'));
// Circle crop: edges cut off, transparent outside the circle.
const circleMask = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
for (const size of [1024, 512, 256]) {
  const base = await sharp(logo)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const circle = await sharp(base)
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png()
    .toBuffer();
  await fs.writeFile(path.join(logoDir, 'rendered', `avatar-circle-${size}.png`), circle);
  if (size === 1024)
    await fs.writeFile(
      path.join(logoDir, 'rendered', 'logo-circle.webp'),
      await sharp(circle).webp({ lossless: true }).toBuffer(),
    );
}
console.log('Avatar derivatives refreshed; approved logo and QR originals preserved.');
