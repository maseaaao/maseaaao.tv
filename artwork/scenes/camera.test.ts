import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../../tooling/artwork/browser.ts';

const directory = import.meta.dir;
const layout = JSON.parse(await readFile(`${directory}/layout.json`, 'utf8'));

test('vertical camera has a blue lower field beneath its higher widget layers', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { height: 1920, width: 1080 } });
    await page.goto(pathToFileURL(`${directory}/04-camera-vertical.html`).href);
    await page.addStyleTag({
      content: await readFile(`${directory}/../../packages/design/tokens.css`, 'utf8'),
    });
    const png = await page.screenshot({ omitBackground: true });
    const result = await page.evaluate(
      async ({ image, zones }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${image}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Missing canvas context');
        }
        context.drawImage(img, 0, 0);
        const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
        const opaque = (box: number[]) => {
          const [x, y, width, height] = box;
          const { data } = context.getImageData(x, y, width, height);
          let count = 0;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0) {
              count += 1;
            }
          }
          return count;
        };
        return {
          chat: pixel(140, 900),
          field: pixel(10, 900),
          opaque: zones.map(opaque),
          top: pixel(10, 100),
        };
      },
      {
        image: png.toString('base64'),
        zones: ['camera', 'social', 'chat', 'music', 'alerts'].map(
          (name) => layout['vertical-camera'][name],
        ),
      },
    );
    expect(result.field).toEqual([22, 22, 217, 255]);
    expect(result.chat).toEqual(result.field);
    expect(result.top[3]).toBe(0);
  } finally {
    await browser.close();
  }
});

test.each(['04-camera-horizontal', '04-camera-vertical'])(
  '%s: donor panel meets camera and social without an opaque blanket',
  async (name) => {
    const browser = await launchBrowser();
    try {
      const scene = layout.files.find((entry: { name: string }) => entry.name === name);
      const page = await browser.newPage({
        viewport: { height: scene.height, width: scene.width },
      });
      await page.goto(pathToFileURL(`${directory}/${scene.file}`).href);
      await page.addStyleTag({
        content: await readFile(`${directory}/../../packages/design/tokens.css`, 'utf8'),
      });
      const zones = await page.locator('[data-zone]').evaluateAll((elements) =>
        Object.fromEntries(
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return [element.getAttribute('data-zone'), [rect.x, rect.y, rect.width, rect.height]];
          }),
        ),
      );
      const map = layout[scene.map];
      for (const zone of ['donors', 'camera', 'social', 'chat', 'music', 'alerts']) {
        expect(zones[zone], `${name}: ${zone}`).toBeDefined();
        for (let i = 0; i < 4; i += 1) {
          expect(zones[zone][i], `${name}: ${zone}`).toBeCloseTo(map[zone][i], 1);
        }
      }
      const [donors, camera, social] = ['donors', 'camera', 'social'].map((zone) => zones[zone]);
      expect(donors[0]).toBe(camera[0]);
      expect(donors[2]).toBe(camera[2]);
      expect(donors[1] + donors[3]).toBeCloseTo(camera[1], 1);
      expect(camera[1] + camera[3]).toBeCloseTo(social[1], 1);
      if (name.endsWith('horizontal')) {
        // Полоса стала шириной от отдельного источника ниже лимита браузера OBS;
        // под ней остаётся светлая полоса с нижним скруглением из оформления.
        const [barWidth] = layout.horizontalCameraStrip.display;
        expect(camera[1] + camera[3]).toBeCloseTo(social[1], 1);
        const bar = zones['social-bar'];
        expect(bar).toBeDefined();
        expect(bar[0]).toBeCloseTo(120, 1);
        expect(bar[1]).toBeCloseTo(social[1] + social[3], 1);
        expect(bar[2]).toBeCloseTo(barWidth, 1);
        expect(bar[3]).toBeCloseTo(28, 1);
      } else {
        expect(await page.locator('.social-bar').count()).toBe(0);
      }
      expect(await page.locator('.lower-background').count()).toBe(
        name.endsWith('vertical') ? 1 : 0,
      );
      expect(
        await page
          .locator('[data-zone="music"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe('rgba(0, 0, 0, 0)');
      expect(
        await page
          .locator('[data-zone="chat"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe('rgba(0, 0, 0, 0)');
    } finally {
      await browser.close();
    }
  },
);
