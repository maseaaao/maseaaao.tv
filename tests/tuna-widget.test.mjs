import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

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
      await page.goto(
        new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url).href + query,
      );
      await page.waitForFunction(() => document.querySelector('#player').dataset.play === '1');
      assert.equal(await page.locator('#title').textContent(), 'Тестовый трек');
      assert((await page.locator('#subtitle').textContent()).includes('Тестовый исполнитель'));
      await page.evaluate(() => document.fonts.ready);
      assert(await page.evaluate(() => document.fonts.check('600 20px Unbounded')));
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
    }
  });
