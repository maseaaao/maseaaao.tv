import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser} from './browser.mjs';
import sharp from 'sharp';
import jsQR from 'jsqr';

const root = path.resolve(import.meta.dirname, '../..');
const scenes = path.join(root, 'artwork/scenes');
const rendered = path.join(scenes, 'rendered');
const layout = JSON.parse(await fs.readFile(path.join(root, 'artwork/scenes/layout.json'), 'utf8'));

const at = box => `left:${box[0]}px;top:${box[1]}px;width:${box[2]}px;height:${box[3]}px`;
const zone = (name, box, panel = false) => `<div class="zone${panel ? ' panel' : ''}" data-zone="${name}" aria-hidden="true" style="${at(box)}"></div>`;
const css = `
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{font-family:var(--hud-body);color:var(--hud-text)}.canvas{position:relative;overflow:hidden;width:var(--width);height:var(--height);background:var(--hud-bg)}
.grid{display:none;opacity:0}
.identity{position:absolute;left:120px;top:112px;display:flex;align-items:center;gap:24px;font-family:var(--hud-display);font-size:32px;font-weight:600;letter-spacing:-.035em;height:64px;background:var(--hud-bg)}
.identity img{width:64px;height:64px;object-fit:contain}.vertical .identity{top:156px;font-size:28px;gap:24px;height:48px}.vertical .identity img{width:48px;height:48px}
.header-rule{position:absolute;left:120px;top:220px;width:1400px;height:1px;background:var(--hud-border)}.vertical .header-rule{top:244px;width:720px}
.title-field{position:absolute;left:88px;top:400px;width:1432px;height:264px;background:var(--hud-accent);border-radius:32px}.vertical .title-field{top:268px;width:784px;height:176px}
h1{position:absolute;left:120px;top:440px;margin:0;font-family:Unbounded,Arial,sans-serif;font-size:160px;line-height:1.08;font-weight:600;letter-spacing:-.035em;color:var(--hud-bg);background:transparent}.vertical h1{top:300px;font-size:88px}
.zone{position:absolute;pointer-events:none}.panel{background:var(--hud-surface);border:1px solid var(--hud-border);border-radius:20px}.zone[data-zone="music"],.zone[data-zone="donors"]{background:var(--hud-bg)}

.qr{position:absolute;display:block;object-fit:contain;image-rendering:pixelated;background:#eee}.social{background:var(--hud-bg);border-top:1px solid var(--hud-border)}
.canvas.overlay:not(.vertical) .zone[data-zone="music"],.canvas.overlay:not(.vertical) .zone[data-zone="donors"]{background:transparent}
.canvas.overlay,.canvas.gameplay,.canvas.camera-tile{background:transparent}.lower-background{position:absolute;left:0;top:608px;width:1080px;height:1312px;overflow:hidden;background:var(--hud-bg)}
.camera-frame{position:absolute;pointer-events:none;border:2px solid var(--hud-accent);border-radius:20px}.camera-tile{border:2px solid var(--hud-accent);border-radius:12px}.vertical .camera-frame{border:0;border-radius:0}
`;

async function validateQr() {
  const qrPath = path.join(root, 'apps/website/public/assets/maseaaao.tv.png');
  const png = await fs.readFile(qrPath);
  const {data, info} = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const url = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
  if (url !== 'https://maseaaao.tv') throw new Error('Supplied QR is missing or unreadable; no substitute QR will be invented.');
  return png;
}
const suppliedQr = await validateQr();
const qrMarkup = box => `<img class="qr" data-zone="qr" style="${at(box)}" src="data:image/png;base64,${suppliedQr.toString('base64')}" alt="QR: maseaaao.tv">`;
function document(name, canvas, vertical, body, mode = '') {
  return `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>maseaaao — ${name}</title><link rel="stylesheet" href="../../packages/design/brand.css"><link rel="stylesheet" href="obs-scene.css"></head><body><main class="canvas${vertical ? ' vertical' : ''}${mode ? ` ${mode}` : ''}" style="--width:${canvas[0]}px;--height:${canvas[1]}px">${body}</main></body></html>\n`;
}
function status(name, copy, vertical) {
  const map = vertical ? layout['vertical-status'] : layout.horizontal;
  const body = `<div class="grid" aria-hidden="true"></div><div class="identity"><img src="../logo/logo.png" alt="">maseaaao</div><div class="header-rule" aria-hidden="true"></div><div class="title-field" aria-hidden="true"></div><h1>${copy}</h1>${zone('chat', map.chat, true)}${zone('music', map.music)}${zone('donors', map.donors)}${zone('alerts', map.alerts)}${vertical ? zone('social', map.social) : ''}${qrMarkup(map.qr)}`;
  return {name, canvas: map.canvas, html: document(name, map.canvas, vertical, body)};
}
function camera(name, vertical) {
  const map = vertical ? layout['vertical-camera'] : layout.horizontal;
  const cameraBox = vertical ? map.camera : [32, 32, 2496, 1376];
  const body = `${vertical ? '<div class="lower-background" aria-hidden="true"><div class="grid"></div></div>' : ''}<div class="camera-frame" data-zone="camera" style="${at(cameraBox)}"></div>${zone('chat', map.chat, vertical)}${zone('music', map.music)}${zone('donors', map.donors)}${zone('alerts', map.alerts)}${vertical ? zone('social', map.social) : qrMarkup(map.qr)}`;
  return {name, canvas: map.canvas, html: document(name, map.canvas, vertical, body, 'overlay')};
}
const definitions = [];
for (const [stem, copy] of [['01-start', 'начало'], ['02-pause', 'пауза'], ['99-end', 'конец']]) {
  definitions.push(status(stem, copy, false), status(`${stem}-vertical`, copy, true));
}
definitions.push(camera('04-camera-horizontal', false), camera('04-camera-vertical', true));
for (const name of ['00-blank', 'background']) {
  const body = '<div class="grid" aria-hidden="true"></div>';
  definitions.push({name, canvas:layout.horizontal.canvas, html:document(name, layout.horizontal.canvas, false, body).replace('--width:', '--hud-bg:#1616d9;--width:')});
}
definitions.push({name:'00-blank-vertical', canvas:[1080,1920], html:document('00-blank-vertical', [1080,1920], true, '', 'gameplay')});
definitions.push({name:'cam-frame', canvas:[600,341], html:document('cam-frame', [600,341], false, '', 'camera-tile')});
await fs.mkdir(rendered, {recursive:true});
await fs.writeFile(path.join(scenes, 'obs-scene.css'), css, 'utf8');
const browser = await launchBrowser();
try {
  for (const definition of definitions) {
    const {name, canvas, html} = definition;
    const htmlPath = path.join(scenes, `${name}.html`);
    await fs.writeFile(htmlPath, html, 'utf8');
    const page = await browser.newPage({viewport:{width:canvas[0], height:canvas[1]}, deviceScaleFactor:1});
    try {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => errors.push(`Asset failed: ${request.url()}`));
      await page.route(/^https?:\/\//, route => route.abort());
      await page.goto(pathToFileURL(htmlPath).href);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      if (errors.length) throw new Error(errors.join('\n'));
      const png = await page.screenshot({omitBackground:true, animations:'disabled'});
      const webp = await sharp(png).webp({lossless:true, effort:6}).toBuffer();
      await fs.writeFile(path.join(rendered, `${name}.webp`), webp);
      const meta = await sharp(webp).metadata();
      if (meta.width !== canvas[0] || meta.height !== canvas[1]) throw new Error(`Wrong dimensions: ${name}`);
      console.log(`rendered ${name}.webp ${meta.width}x${meta.height} ${webp.length} bytes`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
