import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launchBrowser } from '../tooling/artwork/browser.mjs';
import sharp from 'sharp';

test('output statistics uses the fixed light palette without connecting to a real OBS', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      colorScheme: 'dark',
      viewport: { width: 1000, height: 700 },
    });
    await page.addInitScript(() => {
      window.WebSocket = class extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 3;
        close() {}
        send() {}
      };
    });
    await page.goto(
      pathToFileURL(
        resolve(import.meta.dirname, '../apps/obs-widgets/dist/output-stats/index.html'),
      ).href,
    );
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
      'light',
    );
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      'rgb(22, 22, 217)',
    );
    assert.equal(await page.locator('#target-password').inputValue(), '');
  } finally {
    await browser.close();
  }
});

test('social strip remains static, transparent and readable with all five timed logos', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 540, height: 90 },
      colorScheme: 'dark',
    });
    const network = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('file:') && !request.url().startsWith('data:'))
        network.push(request.url());
    });
    await page.goto(
      pathToFileURL(
        resolve(import.meta.dirname, '../apps/obs-widgets/dist/social-strip/index.html'),
      ).href,
    );
    await page.evaluate(() => document.fonts.ready);
    assert.equal(
      await page.locator('script:not([type="text/plain"])').count(),
      0,
      'Static composition ships no browser runtime',
    );
    assert.equal(await page.locator('.logo').count(), 5);
    const timing = await page
      .locator('.logo')
      .evaluateAll((elements) =>
        elements.map((element) => [
          getComputedStyle(element).animationDuration,
          getComputedStyle(element).animationDelay,
        ]),
      );
    assert.deepEqual(timing, [
      ['15s', '0s'],
      ['15s', '-12s'],
      ['15s', '-9s'],
      ['15s', '-6s'],
      ['15s', '-3s'],
    ]);
    for (const width of [320, 390, 540, 1000]) {
      await page.setViewportSize({ width, height: 90 });
      assert(await page.locator('.logos').isVisible());
      assert(
        await page
          .locator('.name')
          .evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
        `${width}: complete name`,
      );
      assert(
        await page
          .locator('.logos')
          .evaluate((element) => element.getBoundingClientRect().left >= 0),
        `${width}: all logos`,
      );
      assert.equal(
        await page.locator('.name').evaluate((element) => getComputedStyle(element).fontWeight),
        '400',
      );
    }
    const { data, info } = await sharp(await page.screenshot({ omitBackground: true }))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0);
    assert.equal(
      data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3],
      255,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert(
      await page
        .locator('.logo')
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              getComputedStyle(element).animationName === 'none' &&
              getComputedStyle(element).opacity === '1',
          ),
        ),
    );
    assert.deepEqual(network, []);
    if (process.env.WIDGET_SHOTS) {
      await page.setViewportSize({ width: 390, height: 90 });
      await page.screenshot({
        path: resolve(process.env.WIDGET_SHOTS, 'social-390.png'),
        omitBackground: true,
      });
    }
  } finally {
    await browser.close();
  }
});

test('transient IndexedDB failure does not delete saved OBS credentials', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const record = JSON.stringify({
        version: 1,
        algorithm: 'AES-GCM',
        iv: 'AAAA',
        ciphertext: 'BBBB',
      });
      localStorage.setItem('easy-output-stats.credentials.v1', record);
      IDBFactory.prototype.open = function () {
        throw new Error('Fixture: temporary IndexedDB failure');
      };
      window.WebSocket = class extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        readyState = 3;
        close() {}
        send() {}
      };
    });
    await page.goto(
      pathToFileURL(resolve(import.meta.dirname, '../apps/obs-widgets/dist/output-stats/index.html')).href,
    );
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Запись сохранена'));
    assert.equal(
      await page.evaluate(() => localStorage.getItem('easy-output-stats.credentials.v1') !== null),
      true,
    );
  } finally {
    await browser.close();
  }
});
