import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import sharp from 'sharp';
import jsQR from 'jsqr';

const root = path.resolve(import.meta.dirname, '../..');
const scenes = path.join(root, '.build-cache/artwork-source/scenes');
const rendered = path.join(root, 'artwork/scenes/rendered');
const layout = JSON.parse(await fs.readFile(path.join(root, 'artwork/scenes/layout.json'), 'utf8'));

const at = (box) => `left:${box[0]}px;top:${box[1]}px;width:${box[2]}px;height:${box[3]}px`;
const zone = (name, box, panel = false) =>
  `<div class="zone${panel ? ' panel' : ''}" data-zone="${name}" aria-hidden="true" style="${at(box)}"></div>`;

async function validateQr() {
  const qrPath = path.join(root, 'apps/website/public/assets/maseaaao.tv.png');
  const png = await fs.readFile(qrPath);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const url = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
  if (url !== 'https://maseaaao.tv')
    throw new Error('Supplied QR is missing or unreadable; no substitute QR will be invented.');
  return png;
}
const suppliedQr = await validateQr();
const qrMarkup = (box) =>
  `<img class="qr" data-zone="qr" style="${at(box)}" src="data:image/png;base64,${suppliedQr.toString('base64')}" alt="QR: maseaaao.tv">`;
function document(name, canvas, vertical, body, mode = '') {
  return `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>maseaaao — ${name}</title><link rel="stylesheet" href="@maseaaao/design/brand.css"><link rel="stylesheet" href="obs-scene.css"></head><body><main class="canvas${vertical ? ' vertical' : ''}${mode ? ` ${mode}` : ''}" style="--width:${canvas[0]}px;--height:${canvas[1]}px">${body}</main></body></html>\n`;
}
function status(name, copy, vertical) {
  const map = vertical ? layout['vertical-status'] : layout.horizontal;
  const body = `<div class="grid" aria-hidden="true"></div><div class="identity"><img src="../../../artwork/logo/logo.png" alt="">maseaaao</div><div class="header-rule" aria-hidden="true"></div><div class="title-field" aria-hidden="true"></div><h1>${copy}</h1>${zone('chat', map.chat, true)}${zone('music', map.music)}${zone('donors', map.donors)}${zone('alerts', map.alerts)}${vertical ? zone('social', map.social) : ''}${qrMarkup(map.qr)}`;
  return { name, canvas: map.canvas, html: document(name, map.canvas, vertical, body) };
}
function camera(name, vertical) {
  const map = vertical ? layout['vertical-camera'] : layout.horizontal;
  const cameraBox = vertical ? map.camera : [32, 32, 2496, 1376];
  const body = `${vertical ? '<div class="lower-background" aria-hidden="true"><div class="grid"></div></div>' : ''}<div class="camera-frame" data-zone="camera" style="${at(cameraBox)}"></div>${zone('chat', map.chat, vertical)}${zone('music', map.music)}${zone('donors', map.donors)}${zone('alerts', map.alerts)}${vertical ? zone('social', map.social) : qrMarkup(map.qr)}`;
  return { name, canvas: map.canvas, html: document(name, map.canvas, vertical, body, 'overlay') };
}
const definitions = [];
for (const [stem, copy] of [
  ['01-start', 'начало'],
  ['02-pause', 'пауза'],
  ['99-end', 'конец'],
]) {
  definitions.push(status(stem, copy, false), status(`${stem}-vertical`, copy, true));
}
definitions.push(camera('04-camera-horizontal', false), camera('04-camera-vertical', true));
for (const name of ['00-blank', 'background']) {
  const body = '<div class="grid" aria-hidden="true"></div>';
  definitions.push({
    name,
    canvas: layout.horizontal.canvas,
    html: document(name, layout.horizontal.canvas, false, body).replace(
      '--width:',
      '--hud-bg:#1616d9;--width:',
    ),
  });
}
definitions.push({
  name: '00-blank-vertical',
  canvas: [1080, 1920],
  html: document('00-blank-vertical', [1080, 1920], true, '', 'gameplay'),
});
definitions.push({
  name: 'cam-frame',
  canvas: [600, 341],
  html: document('cam-frame', [600, 341], false, '', 'camera-tile'),
});
await fs.mkdir(scenes, { recursive: true });
await fs.copyFile(
  path.join(root, 'artwork/scenes/obs-scene.css'),
  path.join(scenes, 'obs-scene.css'),
);
for (const definition of definitions)
  await fs.writeFile(path.join(scenes, definition.name + '.html'), definition.html);
if (!process.argv.includes('--prepare')) {
  const { buildArtwork } = await import('../build-artwork.mjs');
  const { renderImage } = await import('./render-image.mjs');
  await buildArtwork();
  const browser = await launchBrowser();
  try {
    for (const { name, canvas } of definitions)
      await renderImage(browser, {
        source: path.join(root, '.build-cache/artwork/scenes', name + '.html'),
        target: path.join(rendered, name + '.webp'),
        width: canvas[0],
        height: canvas[1],
        format: 'webp',
      });
  } finally {
    await browser.close();
  }
}
