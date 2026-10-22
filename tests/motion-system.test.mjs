import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

const delivery = (path) => new URL(`../${path}`, import.meta.url).href;

if (process.env.MOTION_PREVIEW_OUT) {
  test('capture actual Stream Info motion on demo data', async () => {
    const directory = resolve(process.env.MOTION_PREVIEW_OUT);
    await mkdir(directory, { recursive: true });
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: 540, height: 900 },
        reducedMotion: 'no-preference',
        recordVideo: { dir: directory, size: { width: 540, height: 900 } },
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.routeWebSocket(/.*/, (socket) => void socket.close());
      await page.goto(delivery('apps/stream-info/dist/change-info-streamer-bot.ru.html') + '?demo');
      await page.evaluate(() => document.fonts.ready);
      const settings = page.getByRole('button', { name: 'Настройки', exact: true });
      await settings.waitFor();
      await page.waitForTimeout(700);
      for (let attempt = 0; attempt < 2; attempt++) {
        await settings.click();
        await page.waitForTimeout(900);
        if (attempt === 0) await page.screenshot({ path: join(directory, 'settings.png') });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(800);
      }
      const video = page.video();
      await page.close();
      await video.saveAs(join(directory, 'stream-info.webm'));
    } finally {
      await browser.close();
    }
  });
}

test('settings motion can be interrupted without stealing focus or leaving a blocking layer', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' });
    await page.route(/^https?:/, (route) => route.abort());
    await page.routeWebSocket(/.*/, (socket) => void socket.close());
    await page.goto(delivery('apps/stream-info/dist/change-info-streamer-bot.ru.html') + '?demo');
    const settings = page.getByRole('button', { name: 'Настройки', exact: true });
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      for (let attempt = 0; attempt < 3; attempt++) {
        await settings.click();
        await page.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
        assert(await settings.evaluate((node) => node === document.activeElement));
        assert.equal(await page.locator('.dock-shell[inert]').count(), 0);
      }
      await settings.click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.modal-backdrop').count(), 1);
      assert(
        await page.getByRole('dialog').evaluate((node) => node.contains(document.activeElement)),
      );
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
    }
  } finally {
    await browser.close();
  }
});

test('Tuna responds to motion preference changes in flight, preserving the explicit OBS override', async () => {
  const browser = await launchBrowser();
  try {
    for (const explicit of [false, true]) {
      const page = await browser.newPage({ reducedMotion: 'no-preference' });
      await page.route('http://localhost:1608/**', (route) =>
        route.fulfill({
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ title: 'Спокойный трек', artist: 'Исполнитель', playing: true }),
        }),
      );
      await page.goto(
        delivery('apps/tuna-widget/dist/obs-tuna-widget.html') +
          `?opaque=1&reveal=soft&anim=2000&start=600000&swap=420${explicit ? '&motion=1' : ''}`,
      );
      await page.waitForFunction(() => document.getAnimations().length > 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        (override) =>
          document.documentElement.style.getPropertyValue('--art-swap') ===
          (override ? '420ms' : '0ms'),
        explicit,
      );
      if (!explicit) {
        await page.waitForFunction(() => document.getAnimations().length === 0);
        assert.equal(
          await page.locator('#surface').evaluate((node) => getComputedStyle(node).opacity),
          '1',
        );
        assert.equal(await page.locator('.track-text').count(), 1);
      } else {
        assert(await page.evaluate(() => document.getAnimations().length > 0));
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(
        () => document.documentElement.style.getPropertyValue('--art-swap') === '420ms',
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
