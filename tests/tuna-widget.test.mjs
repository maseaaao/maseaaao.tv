import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';
import sharp from 'sharp';

for (const [query, port] of [
  ['', 1608],
  ['?port=1688&poll=100&img=0.75&ui=1.25&anim=0&swap=0', 1688],
])
  test(`standalone Tuna file:// renders and pauses with query ${query || 'defaults'}`, async () => {
    const html = readFileSync(
      new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url),
      'utf8',
    );
    assert(!html.includes('maseaaao.tv/assets/'));
    assert(html.includes('data:font/woff2;base64,'));
    assert(!html.includes('Geologica'));
    const directory = await mkdtemp(join(tmpdir(), 'tuna-delivery-'));
    const file = join(directory, 'tuna.html');
    await cp(new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url), file);
    const browser = await launchBrowser();
    const page = await browser.newPage({
      viewport: { width: 1000, height: 134 },
      colorScheme: 'dark',
    });
    let playing = true;
    const requests = [],
      errors = [];
    try {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('file:')) return route.continue();
        requests.push(url);
        if (url.startsWith(`http://localhost:${port}/`))
          return route.fulfill({
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
              title: 'Тестовый трек',
              artists: ['Тестовый исполнитель'],
              playing,
            }),
          });
        return route.abort();
      });
      await page.goto(pathToFileURL(file).href + query);
      await page.waitForFunction(() => document.querySelector('#player').dataset.play === '1');
      assert.equal(await page.locator('#title').textContent(), 'Тестовый трек');
      assert((await page.locator('#subtitle').textContent()).includes('Тестовый исполнитель'));
      await page.evaluate(() => document.fonts.ready);
      assert(await page.evaluate(() => document.fonts.check('400 20px Unbounded')));
      if (query)
        assert.equal(
          await page.evaluate(() => document.documentElement.style.getPropertyValue('--img')),
          '0.75',
        );
      playing = false;
      await page.waitForFunction(() => document.querySelector('#player').dataset.play === '0');
      assert.deepEqual(errors, []);
      assert(
        requests.every((url) => url.startsWith(`http://localhost:${port}/`)),
        'No external UI dependencies',
      );
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

test(
  'Tuna keeps bounded cover retries, recovers on a new cover and fits its light transparent delivery',
  { timeout: 30000 },
  async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 540, height: 108 } });
    const attempts = [];
    let cover = '/missing-cover.png';
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=',
      'base64',
    );
    try {
      await page.clock.install();
      const retry = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === '/missing-cover.png' && url.searchParams.get('_tuna')?.endsWith('-1')
        );
      });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.protocol === 'file:') return route.continue();
        if (url.hostname !== 'localhost' || url.port !== '1608') return route.abort();
        if (url.pathname === '/missing-cover.png') {
          attempts.push(url.href);
          return route.abort();
        }
        if (url.pathname === '/valid-cover.png')
          return route.fulfill({ contentType: 'image/png', body: pixel });
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            title: 'Длинное название композиции для узкого источника',
            artist: 'Тестовый исполнитель',
            playing: true,
            cover_url: cover,
          }),
        });
      });
      await page.goto(
        new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url).href +
          '?art=0&retry=100&tries=2&poll=100&anim=0&swap=0&start=600000',
      );
      await retry;
      await page.clock.runFor(1000);
      assert.equal(
        attempts.length,
        2,
        'The configured cover attempt limit is respected during cooldown',
      );
      assert.notEqual(
        attempts[0],
        attempts[1],
        'Each local attempt receives a new cache-busting URL',
      );
      assert.equal(await page.locator('#player').getAttribute('data-cover'), '0');
      cover = '/valid-cover.png';
      await page.clock.runFor(200);
      await page.waitForFunction(() => document.querySelector('#player').dataset.cover === '1');
      assert.equal(
        await page.locator('.cover-image.is-active').evaluate((image) => image.naturalWidth),
        1,
      );
      await page.evaluate(() => document.fonts.ready);
      for (const width of [320, 390, 540, 1000]) {
        await page.setViewportSize({ width, height: 108 });
        const result = await page.evaluate(() => {
          const player = document.querySelector('#player');
          const content = document.querySelector('#content').getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            outside: getComputedStyle(document.body).backgroundColor,
            surface: getComputedStyle(player).backgroundColor,
            text: getComputedStyle(document.querySelector('#title')).color,
            weight: getComputedStyle(document.querySelector('#title')).fontWeight,
            glow: [...document.querySelectorAll('.artwork-glow')].every(
              (image) => getComputedStyle(image).display === 'none',
            ),
            contentFits: content.x >= 0 && content.right <= innerWidth,
          };
        });
        assert.deepEqual(
          result,
          {
            overflow: false,
            outside: 'rgba(0, 0, 0, 0)',
            surface: 'rgb(244, 243, 236)',
            text: 'rgb(32, 32, 30)',
            weight: '400',
            glow: true,
            contentFits: true,
          },
          `${width}px`,
        );
      }
      const screenshot = await page.screenshot({ omitBackground: true });
      const { data, info } = await sharp(screenshot)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(data[3], 0, 'The outer rounded corner remains transparent for OBS');
      assert.equal(
        data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3],
        255,
        'The playing surface remains opaque',
      );
    } finally {
      await browser.close();
    }
  },
);
