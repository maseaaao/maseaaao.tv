import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

// This is the built delivery, not Vite preview. Demo never reaches a live service.
test('Stream Info file://: isolated delivery, 320/390/540, keyboard settings and local fonts', {
  timeout: 60000,
}, async (t) => {
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
      assert.deepEqual(missingWeights, [], 'All requested display weights have a real loaded face');
      const extent = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      assert(extent[0] <= extent[1], `${width}: horizontal overflow ${extent}`);
      const apply = page.getByRole('button', { name: 'Применить изменения', exact: true });
      const applyBefore = await apply.boundingBox();
      assert(applyBefore && applyBefore.y >= 0 && applyBefore.y + applyBefore.height <= 900);
      await page.locator('.dock-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const applyAfter = await apply.boundingBox();
      assert.equal(applyAfter.y, applyBefore.y, 'Apply stays fixed while the dock scrolls');
      assert.equal(
        await page.getByRole('button', { name: 'Сохранить шаблоны', exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByText('%subtitle% — название из соседнего поля', { exact: true }).count(),
        0,
      );
      const template = page.getByLabel('Шаблон Twitch', { exact: true });
      const inputHeight = await template.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      const titleHeight = await page
        .getByLabel('Название', { exact: true })
        .evaluate((element) => element.getBoundingClientRect().height);
      assert.equal(inputHeight + 2, titleHeight, 'Template has the same outer height as the title');
      const originalTemplate = await template.inputValue();
      await template.fill('Before %subtitle% after');
      const token = page.locator('.template-input__highlight mark');
      assert.equal(await token.textContent(), '%subtitle%');
      assert(
        await token.evaluate(
          (element) => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)',
        ),
      );
      await template.fill(
        '<script>plain text</script> ' + 'Long template '.repeat(25) + '%subtitle%',
      );
      assert.equal(
        await page.locator('.template-input script').count(),
        0,
        'Template text is escaped',
      );
      await template.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        element.dispatchEvent(new Event('scroll'));
      });
      const scroll = await page
        .locator('.template-input')
        .evaluate((element) => [
          element.querySelector('input').scrollLeft,
          element.querySelector('.template-input__highlight').scrollLeft,
        ]);
      assert(scroll[0] > 0);
      assert.equal(scroll[0], scroll[1], 'Syntax layer follows input scrolling');
      await template.fill(originalTemplate);
      await page.locator('.dock-scroll').evaluate((element) => {
        element.scrollTop = 0;
      });
      if (width === 540)
        await page.screenshot({
          path: fileURLToPath(
            new URL(
              '../../Streamer.bot/design-preview/stream-info-followup-20261021.png',
              import.meta.url,
            ),
          ),
          fullPage: true,
        });
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
      assert.equal(await dialog.getByLabel('Шаблон Twitch').count(), 0);
      assert(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth));
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      // The accessible dialog disappears immediately; its inert visual exit ends later.
      await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
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
});
