import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {launchBrowser} from '../tooling/artwork/browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
let browser, server, origin;

before(async () => {
  browser = await launchBrowser();
  server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (!file.startsWith(root + path.sep)) throw Error('invalid path');
      res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript', '.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function open(file, width = 1440) {
  const page = await browser.newPage({viewport:{width, height:1000}, reducedMotion:'reduce'});
  await page.route('**/*', route => route.request().url().startsWith(origin + '/')
    ? route.continue() : route.fulfill({contentType:'text/html', body:'<!doctype html><title>Isolated media</title>'}));
  await page.goto(origin + '/' + file);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

test('checker adds each player once, removes players, and keeps the correct embed destinations', async () => {
  const page = await open('apps/website/public/check.html');
  try {
    await page.locator('[data-action="add-all"]').click();
    assert.equal(await page.locator('iframe').count(), 2);
    const sources = await page.locator('iframe').evaluateAll(es => es.map(e => e.src));
    assert.equal(new URL(sources[0]).searchParams.get('channel'), 'UCyJNPWpOcPfMo5csKa27yGg');
    assert.equal(new URL(sources[1]).searchParams.get('channel'), 'maseaaao');
    assert.equal(new URL(sources[1]).searchParams.get('parent'), '127.0.0.1');
    await page.locator('[data-action="add-all"]').click();
    assert.equal(await page.locator('iframe').count(), 2);
    await page.locator('[data-action="remove-all"]').click();
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.locator('.placeholder').count(), 2);
    await page.locator('[data-platform="twitch"] [data-action="add"]').click();
    assert.equal(await page.locator('iframe').count(), 1);
    await page.locator('[data-platform="twitch"] [data-action="remove"]').click();
    assert.equal(await page.locator('iframe').count(), 0);
  } finally { await page.close(); }
});

test('TV mode uses two full-width rows for two players on every viewport', async () => {
  for (const width of [320,390,540,768,1440]) {
    const page = await open('apps/website/public/check.html?tv=1', width);
    try {
      assert.equal(await page.locator('iframe').count(), 2);
      assert.equal(new URL(await page.locator('[data-platform="youtube"] iframe').getAttribute('src')).searchParams.get('mute'), '0');
      const boxes = await page.locator('.card').evaluateAll(es => es.map(e => {
        const r = e.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, bottom:r.bottom};
      }));
      assert.equal(boxes[0].x, boxes[1].x);
      assert.equal(boxes[0].width, boxes[1].width, `${width}px: both sources use the available width`);
      assert.ok(boxes[1].y >= boxes[0].bottom);
      assert.ok(Math.abs(boxes[1].bottom - 992) <= 1, `${width}px: no empty third row`);
    } finally { await page.close(); }
  }
});

for (const file of ['check.html','docs.html']) {
  test(`${file} keeps readable local typography, focus and controls at narrow widths and enlarged text`, async () => {
    for (const width of [320,390,540,768,1440]) {
      const page = await open('apps/website/public/' + file, width);
      try {
        for (const enlarged of [false,true]) {
          if (enlarged) await page.evaluate(() => {
            const elements = [...document.querySelectorAll('body, body *')];
            const sizes = elements.map(e => parseFloat(getComputedStyle(e).fontSize));
            elements.forEach((e, i) => { e.style.fontSize = sizes[i] * 2 + 'px'; });
          });
          const ui = await page.evaluate(() => ({
            overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth,
            bodyFont:getComputedStyle(document.body).fontFamily,
            accentLoaded:[...document.fonts].some(f => f.family === 'Unbounded' && f.status === 'loaded'),
            small:[...document.querySelectorAll('a,button')].filter(e => e.checkVisibility() && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).map(e => e.textContent),
          }));
          assert.equal(ui.overflow, false, `${file}/${width}/text ${enlarged ? '200%' : '100%'}`);
          assert.match(ui.bodyFont, /Arial/);
          assert.equal(ui.accentLoaded, true);
          assert.deepEqual(ui.small, []);
        }
        if (file === 'check.html') {
          await page.keyboard.press('Tab');
          assert.equal(await page.locator(':focus').evaluate(e => getComputedStyle(e).outlineWidth), '3px');
        }
      } finally { await page.close(); }
    }
  });
}

test('all banners and Twitch panels load local fonts without clipping supplied headings', async () => {
  const panels = (await fs.readdir(path.join(root, 'artwork/twitch-description'))).filter(f => f.endsWith('.html'));
  for (const item of [
    {file:'artwork/banners/twitch-schedule.html', width:1200, height:480},
    {file:'artwork/banners/youtube-schedule.html', width:2560, height:1440},
    ...panels.map(file => ({file:'artwork/twitch-description/' + file, width:320, height:64})),
  ]) {
    const page = await open(item.file, item.width);
    try {
      await page.setViewportSize({width:item.width, height:item.height});
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => [...document.fonts].some(f => f.family === 'Unbounded' && f.status === 'loaded')), true, item.file + ': accent font must actually load');
      const heading = await page.locator('h1').evaluate(e => {
        const r = e.getBoundingClientRect();
        const parent = e.closest('.composition,.twitch-panel').getBoundingClientRect();
        return {text:e.textContent, scroll:e.scrollWidth, width:e.clientWidth, left:r.left, right:r.right, top:r.top, bottom:r.bottom, parent:{left:parent.left,right:parent.right,top:parent.top,bottom:parent.bottom}, font:getComputedStyle(e).fontFamily};
      });
      assert.ok(heading.text.trim());
      assert.match(heading.font, /Unbounded/);
      assert.ok(heading.scroll <= heading.width, item.file + ': heading must not truncate');
      assert.ok(heading.left >= heading.parent.left && heading.right <= heading.parent.right, item.file + ': horizontal safe area');
      assert.ok(heading.top >= heading.parent.top && heading.bottom <= heading.parent.bottom, item.file + ': vertical safe area');
    } finally { await page.close(); }
  }
});
