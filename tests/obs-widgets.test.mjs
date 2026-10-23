import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

test('social strip keeps its shell still and readable during a rare wave of all five logos', async () => {
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
      ['30s', '1.5s'],
      ['30s', '1.65s'],
      ['30s', '1.8s'],
      ['30s', '1.95s'],
      ['30s', '2.1s'],
    ]);
    const wave = await page.evaluate(async () => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      const base = { name: rect('.name'), strip: rect('.strip'), divider: rect('.divider') };
      const animations = document.getAnimations();
      animations.forEach((animation) => {
        animation.pause();
      });
      const samples = [];
      // Peak: 1500ms initial delay + 1.4% of the 30000ms cycle.
      for (const ms of [
        0, 1500, 1800, 1920, 2000, 2300, 2600, 3100, 4000, 15000, 29000, 31800, 31920, 34000,
      ]) {
        animations.forEach((animation) => {
          animation.currentTime = ms;
        });
        await new Promise(requestAnimationFrame);
        const icons = [...document.querySelectorAll('.logo')].map((node) => {
          const style = getComputedStyle(node),
            pose = new DOMMatrixReadOnly(style.transform);
          return { opacity: Number(style.opacity), scale: pose.a, y: pose.f };
        });
        samples.push({
          ms,
          name: rect('.name'),
          strip: rect('.strip'),
          divider: rect('.divider'),
          icons,
        });
      }
      return { base, samples };
    });
    for (const sample of wave.samples) {
      assert.deepEqual(
        { name: sample.name, strip: sample.strip, divider: sample.divider },
        wave.base,
      );
      assert(
        sample.icons.every(
          (icon) =>
            icon.opacity >= 0.819 &&
            icon.opacity <= 1 &&
            icon.scale >= 0.959 &&
            icon.scale <= 1.081 &&
            icon.y >= -3.01 &&
            icon.y <= 1.01,
        ),
      );
      if ([0, 4000, 15000, 29000, 34000].includes(sample.ms))
        assert(
          sample.icons.every((icon) => Math.abs(icon.y) < 0.01 && Math.abs(icon.scale - 1) < 0.001),
          'Long quiet intervals are still',
        );
    }
    assert(
      wave.samples.some((sample) => sample.icons.some((icon) => icon.y < -1.5)),
      'The wave is visible',
    );
    assert(
      wave.samples.find((sample) => sample.ms === 31920).icons[0].y < -1.5,
      'The wave repeats after 30 seconds',
    );
    // Compare both cycles, including every staggered icon, not just visibility.
    for (const ms of [1800, 1920]) {
      const first = wave.samples.find((sample) => sample.ms === ms).icons;
      const repeated = wave.samples.find((sample) => sample.ms === ms + 30000).icons;
      for (let index = 0; index < first.length; index++) {
        for (const property of ['opacity', 'scale', 'y']) {
          assert(
            Math.abs(first[index][property] - repeated[index][property]) < 0.0001,
            `${ms}ms: logo ${index + 1} ${property} repeats after 30 seconds`,
          );
        }
      }
    }
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
    assert(data[3] > 0, 'Attached top edge has square, filled corners');
    assert.equal(data[(info.height - 1) * info.width * 4 + 3], 0, 'Lower corners stay rounded');
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
    await page.addStyleTag({
      content:
        ':root{--social-animation:social-wave!important;--social-rest-opacity:.82!important}',
    });
    assert(
      await page
        .locator('.logo')
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              getComputedStyle(element).animationName === 'social-wave' &&
              getComputedStyle(element).animationDuration === '30s',
          ),
        ),
      'Explicit OBS motion survives the desktop reduced-motion preference',
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
