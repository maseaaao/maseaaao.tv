import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser} from '../scripts/browser.mjs';
import sharp from 'sharp';
import jsQR from 'jsqr';

const root = path.resolve(import.meta.dirname, '..');
const scenes = path.join(root, 'src/scenes');
const layout = JSON.parse(await fs.readFile(path.join(root, 'assets/cyber-monolith/obs-layout.json'), 'utf8'));
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

for (const [stem, copy] of [['01-start', 'начало'], ['02-pause', 'пауза'], ['99-end', 'конец']]) {
  for (const vertical of [false, true]) {
    const name = stem + (vertical ? '-vertical' : '');
    test(`${name}: offline status with reserved live zones and readable supplied QR`, async () => {
      const map = vertical ? layout['vertical-status'] : layout.horizontal;
      const [width, height] = map.canvas;
      const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1});
      try {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => errors.push(request.url()));
        await page.goto(pathToFileURL(path.join(scenes, `${name}.html`)).href);
        await page.evaluate(() => document.fonts.ready);
        const heading = page.locator('h1');
        assert.equal(await heading.count(), 1, 'scene must render one functional status heading');
        assert.equal(await heading.textContent(), copy);
        const bounds = await heading.boundingBox();
        assert.equal(bounds.x, 120);
        assert.equal(bounds.y, vertical ? 300 : 440);
        assert.equal(await heading.evaluate(e => getComputedStyle(e).fontFamily), 'Unbounded, sans-serif');
        assert.equal(await heading.evaluate(e => getComputedStyle(e).color), 'rgb(244, 243, 236)');
        assert.ok(await page.evaluate(() => document.fonts.check('600 88px Unbounded')));
        assert.ok(await page.evaluate(() => document.fonts.check('400 32px Arial')));
        for (const key of ['chat', 'music', 'donors', 'alerts']) {
          const slot = page.locator(`[data-zone="${key}"]`);
          assert.equal(await slot.count(), 1, `missing ${key} reserved zone`);
          const box = await slot.boundingBox();
          for (const [i, property] of ['x', 'y', 'width', 'height'].entries()) {
            assert.ok(Math.abs(box[property] - map[key][i]) < 1 / 64, `${key}.${property} matches the mapping within Chromium subpixel precision`);
          }
          assert.deepEqual(await slot.evaluate(e => ['left', 'top', 'width', 'height'].map(k => parseFloat(e.style[k]))), map[key]);
          assert.equal((await slot.textContent()).trim(), '', `${key} must not contain demo data`);
        }
        const qr = page.locator('[data-zone="qr"]');
        assert.deepEqual(await qr.boundingBox(), Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, map.qr[i]])));
        assert.equal(await page.locator('body').innerText(), `maseaaao\n${copy}`);
        assert.equal(await page.evaluate(() => document.querySelector('.grid').style.opacity || getComputedStyle(document.querySelector('.grid')).opacity), '0');
        assert.deepEqual(errors, []);
        const image = path.join(scenes, 'rendered', `${name}.webp`);
        const meta = await sharp(image).metadata();
        assert.equal(meta.width, width); assert.equal(meta.height, height);
        const {data, info} = await sharp(image).extract({left: map.qr[0], top: map.qr[1], width: map.qr[2], height: map.qr[3]}).ensureAlpha().raw().toBuffer({resolveWithObject: true});
        assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, 'https://maseaaao.tv', 'production-size QR must decode');
      } finally { await page.close(); }
    });
  }
}

for (const vertical of [false, true]) {
  const name = vertical ? '04-camera-vertical' : '04-camera-horizontal';
  test(`${name}: transparent camera window with opaque HUD panels`, async () => {
    const map = vertical ? layout['vertical-camera'] : layout.horizontal;
    const image = path.join(scenes, 'rendered', `${name}.webp`);
    assert.ok(await fs.stat(path.join(scenes, `${name}.html`)).catch(() => false), 'camera HTML must exist');
    const meta = await sharp(image).metadata();
    assert.deepEqual([meta.width, meta.height], map.canvas);
    assert.ok(meta.hasAlpha, 'camera overlay needs an alpha channel');
    const {data, info} = await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    assert.equal(pixel(vertical ? 540 : 900, vertical ? 304 : 720)[3], 0, 'camera center must be fully transparent');
    if (vertical) assert.deepEqual(pixel(map.chat[0] + 200, map.chat[1] + 200), [255, 254, 248, 255], 'vertical chat backdrop belongs to the intentionally opaque lower section');
    else assert.equal(pixel(map.chat[0] + 200, map.chat[1] + 200)[3], 0, 'horizontal chat backing is owned by the active widget, never a permanent camera HUD block');
    if (vertical) {
      assert.equal(pixel(540, 607)[3], 0, 'last camera row remains transparent');
      assert.equal(pixel(540, 608)[3], 255, 'lower background starts exactly at y=608');
    }
    const page = await browser.newPage({viewport:{width:map.canvas[0],height:map.canvas[1]}});
    try {
      await page.goto(pathToFileURL(path.join(scenes, `${name}.html`)).href);
      assert.equal(await page.locator('body').innerText(), '', 'no synthetic labels in camera frame');
      for (const key of ['chat','music','donors','alerts']) {
        assert.deepEqual(await page.locator(`[data-zone="${key}"]`).evaluate(e => ['left','top','width','height'].map(k => parseFloat(e.style[k]))), map[key]);
      }
    } finally { await page.close(); }
  });
}

test('cam-frame: exact 600x341 blue frame with a transparent center', async () => {
  const image=path.join(scenes,'rendered/cam-frame.webp');
  const meta=await sharp(image).metadata();
  assert.deepEqual([meta.width,meta.height,meta.hasAlpha],[600,341,true]);
  const {data,info}=await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const alpha=(x,y)=>data[(y*info.width+x)*4+3];
  assert.equal(alpha(300,170),0);
  assert.equal(alpha(300,0),255);
  assert.deepEqual([...data.subarray(300*4,300*4+3)],[22,22,217]);
});

test('blank horizontal and background: quiet full-size Cyber-Monolith surfaces', async () => {
  for (const name of ['00-blank','background']) {
    const image = path.join(scenes,'rendered',`${name}.webp`);
    const meta = await sharp(image).metadata();
    assert.deepEqual([meta.width,meta.height],[2560,1440]);
    const page = await browser.newPage({viewport:{width:2560,height:1440}});
    try {
      await page.goto(pathToFileURL(path.join(scenes,`${name}.html`)).href);
      assert.equal(await page.locator('body').innerText(),'');
      assert.equal(await page.locator('.grid').count(),1,'quiet surface uses the restrained HUD grid');
      assert.equal(await page.locator('.grid').evaluate(e => getComputedStyle(e).opacity),'0');
    } finally { await page.close(); }
  }
});

test('scene manifest: actual filenames and authoritative live-source mapping', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(scenes,'layout.json'),'utf8'));
  assert.equal(manifest.design,'Синий / светлый');
  assert.deepEqual(manifest.horizontal,layout.horizontal);
  assert.deepEqual(manifest['vertical-status'],layout['vertical-status']);
  assert.deepEqual(manifest['vertical-camera'],layout['vertical-camera']);
  const expected = ['01-start','01-start-vertical','02-pause','02-pause-vertical','99-end','99-end-vertical','04-camera-horizontal','04-camera-vertical','00-blank','background','00-blank-vertical','cam-frame'];
  assert.deepEqual(manifest.files.map(file => file.name).sort(),expected.sort());
  for (const file of manifest.files) {
    assert.equal(file.file,`${file.name}.html`);
    assert.equal(file.rendered,`rendered/${file.name}.webp`);
    const meta = await sharp(path.join(scenes,file.rendered)).metadata();
    assert.deepEqual([meta.width,meta.height],[file.width,file.height]);
  }
});

test('all exports: lossless pixel parity with offline Chrome screenshots', async () => {
  const standalone = await launchBrowser();
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(scenes,'layout.json'),'utf8'));
    for (const file of manifest.files) {
      const page = await standalone.newPage({viewport:{width:file.width,height:file.height},deviceScaleFactor:1});
      try {
        await page.goto(pathToFileURL(path.join(scenes,file.file)).href);
        await page.evaluate(()=>document.fonts.ready);
        await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
        const capture=await page.screenshot({omitBackground:true,animations:'disabled'});
        const actual=await sharp(capture).ensureAlpha().raw().toBuffer();
        const exported=await sharp(path.join(scenes,file.rendered)).ensureAlpha().raw().toBuffer();
        if (!actual.equals(exported)) {
          let diff=0;
          for (let i=0;i<actual.length;i++) if (actual[i]!==exported[i]) diff++;
          assert.fail(`${file.name}: mismatch in ${diff} bytes`);
        }
      } finally { await page.close(); }
    }
  } finally { await standalone.close(); }
});

test('scenes have no decorative corner markers', async () => {
  const manifest=JSON.parse(await fs.readFile(path.join(scenes,'layout.json'),'utf8'));
  for(const file of manifest.files) {
    const html=await fs.readFile(path.join(scenes,file.file),'utf8');
    assert.doesNotMatch(html,/class="corner /);
  }
});

test('blank vertical: gameplay and camera remain completely unobstructed', async () => {
  const image = path.join(scenes,'rendered/00-blank-vertical.webp');
  const {data,info} = await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width,info.height],[1080,1920]);
  for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 0, 'gameplay blank must never obscure capture');
});
