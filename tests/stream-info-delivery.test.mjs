import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

// This is the built delivery, not Vite preview. Demo never reaches a live service.
test(
  'Stream Info file://: isolated delivery, 320/390/540, keyboard settings and local fonts',
  { timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'stream-info-delivery-'));
    const file = join(directory, 'dock.html');
    const browser = await launchBrowser();
    try {
      await cp(
        new URL('../apps/stream-info/dist/change-info-streamer-bot.ru.html', import.meta.url),
        file,
      );
      for (const width of [320, 390, 540, 1280]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        const sockets = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          if (!request.url().startsWith('file:') && !request.url().startsWith('data:'))
            requests.push(request.url());
        });
        await page.route(/^https?:/, (route) => route.abort());
        await page.routeWebSocket(/.*/, (socket) => {
          sockets.push(socket.url());
          void socket.close();
        });
        await page.goto(`${pathToFileURL(file).href}?demo`);
        await page.getByRole('button', { name: 'Настройки', exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert(await page.evaluate(() => document.fonts.check('400 24px Unbounded')));
        const missingWeights = await page.evaluate(async () => {
          const weights = new Set(
            [...document.querySelectorAll('*')]
              .filter((element) => element.getClientRects().length && element.textContent.trim())
              .map((element) => getComputedStyle(element))
              .filter((style) => style.fontFamily.includes('Unbounded'))
              .map((style) => style.fontWeight),
          );
          const missing = [];
          for (const weight of weights) {
            const fonts = await document.fonts.load(`${weight} 20px Unbounded`, 'Проверка English');
            if (!fonts.some((font) => font.status === 'loaded' && font.weight === weight))
              missing.push(weight);
          }
          return missing;
        });
        assert.deepEqual(
          missingWeights,
          [],
          'All requested display weights have a real loaded face',
        );
        const extent = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
        ]);
        assert(extent[0] <= extent[1], `${width}: horizontal overflow ${extent}`);
        const settings = page.getByRole('button', { name: 'Настройки', exact: true });
        await settings.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        assert(
          await dialog.evaluate((element) => element.contains(document.activeElement)),
          'focus enters settings',
        );
        const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
        const saveConnection = dialog.getByRole('button', { name: 'Сохранить подключение' });
        await close.focus();
        await page.keyboard.press('Shift+Tab');
        assert(await saveConnection.evaluate((element) => element === document.activeElement));
        await page.keyboard.press('Tab');
        assert(await close.evaluate((element) => element === document.activeElement));
        await dialog.getByRole('button', { name: 'Сохранить шаблоны' }).scrollIntoViewIfNeeded();
        assert(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth));
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert(
          await settings.evaluate((element) => element === document.activeElement),
          'focus returns to settings trigger',
        );
        assert.equal(await page.locator('[inert]').count(), 0, 'Background is interactive again');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert(
          await page
            .locator('button')
            .evaluateAll((elements) =>
              elements.every((element) => getComputedStyle(element).transitionDuration === '0s'),
            ),
          'Reduced motion disables control transitions',
        );
        await page.evaluate(() => {
          const text = [...document.querySelectorAll('*')]
            .filter((element) => element instanceof HTMLElement && element.getClientRects().length)
            .filter(
              (element) =>
                [...element.childNodes].some(
                  (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
                ) || element.matches('input, textarea'),
            )
            .map((element) => [element, parseFloat(getComputedStyle(element).fontSize)]);
          for (const [element, size] of text) element.style.fontSize = `${size * 2}px`;
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
          `${width}: doubled text fits horizontally`,
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(requests, []);
        assert.deepEqual(sockets, []);
        await context.close();
      }
      t.diagnostic(
        `Built delivery checked in Chromium ${browser.version()} (${process.platform}); target Windows 11/OBS remains separate.`,
      );
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
