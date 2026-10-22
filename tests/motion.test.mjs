import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

const root = resolve(import.meta.dirname, '..');
let browser, server, origin;
before(async () => {
  const output = resolve(root, 'dist');
  server = createServer((request, response) => {
    try {
      const path = resolve(output, '.' + new URL(request.url, 'http://localhost').pathname);
      if (!path.startsWith(output + sep)) throw Error('Invalid path');
      response.setHeader(
        'Content-Type',
        { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(path)] ||
          'application/octet-stream',
      );
      response.end(readFileSync(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

test('landing introduction never hides links, moves layout or keeps animating at rest', async () => {
  for (const width of [320, 390, 540, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'no-preference',
    });
    try {
      const page = await context.newPage();
      await page.goto(origin + '/index.html');
      const poses = await page.evaluate(async () => {
        const groups = [...document.querySelectorAll('.shell > *')];
        const animations = groups.flatMap((group) => group.getAnimations());
        animations.forEach((animation) => animation.pause());
        const samples = [];
        for (const time of [0, 80, 180, 430]) {
          animations.forEach((animation) => (animation.currentTime = time));
          await new Promise(requestAnimationFrame);
          samples.push(
            groups.map((group) => ({
              opacity: Number(getComputedStyle(group).opacity),
              top: group.offsetTop,
              height: group.offsetHeight,
              y: new DOMMatrixReadOnly(getComputedStyle(group).transform).f,
            })),
          );
        }
        animations.forEach((animation) => animation.finish());
        return { samples, running: document.getAnimations().length };
      });
      for (const sample of poses.samples) {
        assert.deepEqual(
          sample.map(({ top, height }) => ({ top, height })),
          poses.samples[0].map(({ top, height }) => ({ top, height })),
          'Animation must not shift layout',
        );
        assert(sample.every((pose) => pose.opacity >= 0.64 && pose.y >= 0 && pose.y <= 6.01));
      }
      assert(poses.samples.at(-1).every((pose) => pose.opacity === 1 && pose.y === 0));
      assert.equal(poses.running, 0, 'The landing has no ambient animation');
      assert(await page.locator('.tile--twitch').isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } finally {
      await context.close();
    }
  }
});

test('keyboard cancels the intro; reduced motion also removes press displacement', async () => {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  try {
    await page.goto(origin + '/index.html');
    await page.locator('.tile--twitch').focus();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    const link = page.locator('.tile--twitch');
    const rest = await link.boundingBox();
    await link.hover();
    await page.mouse.down();
    await link.evaluate((element) => {
      getComputedStyle(element).transform;
      element.getAnimations().forEach((animation) => animation.finish());
    });
    const pressed = await link.boundingBox();
    assert.equal(pressed.width, rest.width, 'Pressing never scales the label');
    assert(Math.abs(pressed.y - rest.y - 1) < 0.01);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await link.evaluate((element) => {
      getComputedStyle(element).transform;
      element.getAnimations().forEach((animation) => animation.finish());
    });
    assert.deepEqual(await link.boundingBox(), rest);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await link.hover();
    await page.mouse.down();
    assert.equal(await link.evaluate((element) => getComputedStyle(element).transform), 'none');
    await page.mouse.move(0, 0);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  } finally {
    await page.close();
  }
});

test('closing settings during entry keeps the background inert and restores keyboard focus', async () => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ reducedMotion, viewport: { width: 390, height: 900 } });
    try {
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(
        pathToFileURL(resolve(root, 'apps/stream-info/dist/change-info-streamer-bot.ru.html'))
          .href + '?demo',
      );
      const settings = page.getByRole('button', { name: 'Настройки', exact: true });
      const restingButton = await settings.boundingBox();
      await settings.hover();
      await page.mouse.down();
      await settings.evaluate((element) => {
        getComputedStyle(element).transform;
        element.getAnimations().forEach((animation) => animation.finish());
      });
      const pressedButton = await settings.boundingBox();
      assert.equal(pressedButton.width, restingButton.width);
      assert(
        Math.abs(pressedButton.y - restingButton.y - (reducedMotion === 'reduce' ? 0 : 1)) < 0.01,
      );
      await page.mouse.move(0, 0);
      await page.mouse.up();
      for (let attempt = 0; attempt < 3; attempt++) {
        await settings.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('dialog').waitFor();
        assert(await page.locator('.dock-shell').evaluate((element) => element.inert));
        assert(
          await page
            .getByRole('dialog')
            .evaluate((element) => element.contains(document.activeElement)),
        );
        // Finish neither the entry nor its settling phase before asking to close.
        await page.keyboard.press('Escape');
        if (reducedMotion === 'no-preference') {
          const leaving = page.locator('.settings-leave-active');
          assert(await leaving.evaluate((element) => element.inert));
          assert.equal(await leaving.getAttribute('aria-hidden'), 'true');
          assert(await page.locator('.dock-shell').evaluate((element) => element.inert));
        }
        await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.dock-shell').evaluate((element) => element.inert), false);
        assert(await settings.evaluate((element) => element === document.activeElement));
      }
      const query = page.getByRole('combobox');
      await query.fill('pu');
      const results = page.locator('.category-popover');
      await results.waitFor();
      await results.evaluate((element) => {
        element.getAnimations().forEach((animation) => animation.finish());
      });
      await query.fill('pub');
      assert.equal(
        await results.evaluate((element) => element.getAnimations().length),
        0,
        'Updating the query must not replay the list entrance',
      );
      await query.fill('');
      assert.equal(await page.locator('.category-popover').count(), 0);
      assert(await query.evaluate((element) => element === document.activeElement));
      if (reducedMotion === 'reduce')
        assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    } finally {
      await page.close();
    }
  }
});
