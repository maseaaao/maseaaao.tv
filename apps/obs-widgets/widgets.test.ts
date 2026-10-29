import { afterAll, beforeAll, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';

let browser: Browser;
let server: ViteDevServer;
let donorCss: string;

beforeAll(async () => {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      (process.platform === 'win32'
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        : undefined),
    headless: true,
  });
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const result = await server.transformRequest(
    '/src/donors/donationalerts-stream-stats.css?direct',
  );
  if (!result) {
    throw new Error('Donor CSS did not load');
  }
  donorCss = result.code;
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

test('strip keeps square corners everywhere', async () => {
  const page = await browser.newPage({ viewport: { height: 88, width: 720 } });
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
    const radii = await page.locator('.strip').evaluate((element) => {
      const css = getComputedStyle(element);
      return [css.borderBottomLeftRadius, css.borderTopLeftRadius];
    });
    expect(radii).toEqual(['0px', '0px']);
  } finally {
    await page.close();
  }
});

test.each([400, 480, 640, 720, 1080, 1280, 2560])(
  'social variants fit source width %i',
  async (width) => {
    const page = await browser.newPage({ viewport: { height: 64, width } });
    try {
      {
        await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
        const metrics = await page.locator('.strip').evaluate((element) => {
          const style = getComputedStyle(element);
          const logo = element.querySelector('.logo');
          if (!logo) {
            throw new Error('Missing logo');
          }
          const logoStyle = getComputedStyle(logo);
          return {
            bottom: style.borderBottomLeftRadius,
            logoWidth: Number.parseFloat(logoStyle.width),
            scrollWidth: element.scrollWidth,
            width: element.clientWidth,
          };
        });
        expect(metrics.bottom).toBe('0px');
        expect(metrics.logoWidth).toBeGreaterThan(width < 540 ? 18 : 20);
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
        await page.evaluate(() => document.fonts.ready);
        if (process.env.WIDGET_SCREENSHOTS) {
          await page.screenshot({
            path: `${process.env.WIDGET_SCREENSHOTS}/social-${width}.png`,
          });
        }
      }
    } finally {
      await page.close();
    }
  },
);

test('480px gameplay social strip is readable without clipping', async () => {
  const page = await browser.newPage({ viewport: { height: 64, width: 480 } });
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.locator('.strip').evaluate((element) => {
      const name = element.querySelector('.name');
      const icon = element.querySelector('.logo');
      if (!(name && icon)) {
        throw new Error('Missing social content');
      }
      return {
        iconSize: icon.getBoundingClientRect().width,
        nameSize: Number.parseFloat(getComputedStyle(name).fontSize),
        scrollWidth: element.scrollWidth,
        width: element.clientWidth,
      };
    });
    expect(metrics.nameSize).toBeGreaterThanOrEqual(28);
    expect(metrics.iconSize).toBeGreaterThanOrEqual(28);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
  } finally {
    await page.close();
  }
});

test('social animation keeps its period, stagger and movement', async () => {
  const page = await browser.newPage({
    reducedMotion: 'no-preference',
    viewport: { height: 64, width: 720 },
  });
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
    const details = await page.locator('.logo').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return [
          style.animationName,
          style.animationDuration,
          style.animationDelay,
          style.animationIterationCount,
        ];
      }),
    );
    expect(details).toEqual(
      ['1.5s', '1.65s', '1.8s', '1.95s', '2.1s'].map((delay) => [
        'social-wave',
        '30s',
        delay,
        'infinite',
      ]),
    );
    const positions = await page
      .locator('.logo')
      .first()
      .evaluate(async (element) => {
        const [animation] = element.getAnimations();
        if (!animation) {
          throw new Error('Missing social animation');
        }
        animation.pause();
        await animation.ready;
        return [1500, 1920, 31_500].map((time) => {
          animation.currentTime = time;
          return getComputedStyle(element).transform;
        });
      });
    expect(positions[0]).not.toBe(positions[1]);
    expect(positions[0]).toBe(positions[2]);
  } finally {
    await page.close();
  }
});

test.each([
  [720, 'list'],
  [720, 'slider'],
  [1100, 'list'],
  [1100, 'slider'],
] as const)('long donor fits %i px %s and keeps roll timing', async (width, mode) => {
  const page = await browser.newPage({
    reducedMotion: 'no-preference',
    viewport: { height: 134, width },
  });
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
    const item =
      '<div class="stats-list-item"><div class="stats-item-main-row">ОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьОченьДлинноеИмяДонатера</div><div class="stats-item-additional-row">999 999 RUB</div></div>';
    const shell =
      mode === 'list'
        ? `<div class="stats-list">${item}</div>`
        : `<div class="stats-slider"><div class="stats-slider-wrapper">${item}</div></div>`;
    await page.setContent(
      `<style>${donorCss}</style><div style="display:table;width:100%;height:134px"><div style="display:table-row"><div style="display:table-cell;vertical-align:bottom"><div class="widget-stream-stats">${shell}</div></div></div></div>`,
    );
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.locator('.stats-list-item').evaluate((element) => {
      const main = element.querySelector('.stats-item-main-row');
      const additional = element.querySelector('.stats-item-additional-row');
      if (!(main instanceof HTMLElement && additional instanceof HTMLElement)) {
        throw new Error('Missing donor rows');
      }
      const itemRect = element.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const additionalRect = additional.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        additionalRect: additionalRect.toJSON(),
        clamp: getComputedStyle(main).webkitLineClamp,
        itemRect: itemRect.toJSON(),
        mainRect: mainRect.toJSON(),
        transitionDuration: style.transitionDuration,
        transitionProperty: style.transitionProperty,
      };
    });
    expect(metrics.mainRect.left).toBeGreaterThanOrEqual(metrics.itemRect.left);
    expect(metrics.mainRect.right).toBeLessThanOrEqual(metrics.itemRect.right);
    expect(metrics.additionalRect.bottom).toBeLessThanOrEqual(metrics.itemRect.bottom);
    expect(metrics.clamp).toBe('1');
    expect(metrics.transitionDuration).toBe('0.52s, 0.52s, 0.52s');
    expect(metrics.transitionProperty).toBe('translate, rotate, scale');
    if (process.env.WIDGET_SCREENSHOTS) {
      await page.screenshot({
        path: `${process.env.WIDGET_SCREENSHOTS}/donor-${mode}-${width}.png`,
      });
    }
    const transitions = await page.locator('.stats-list-item').evaluate((element) => {
      const html = element as HTMLElement;
      html.style.setProperty('transition', 'none', 'important');
      html.classList.add('fade-in-out-enter-from');
      const start = getComputedStyle(html).translate;
      html.style.transition = '';
      html.classList.remove('fade-in-out-enter-from');
      const current = getComputedStyle(html).translate;
      return {
        current,
        durations: html.getAnimations().map((animation) => animation.effect?.getTiming().duration),
        start,
      };
    });
    expect(transitions.start).toBe('0px 100%');
    expect(transitions.durations).toEqual([520, 520, 520]);
  } finally {
    await page.close();
  }
});

test('donor shell rounds only the upper corners', async () => {
  const page = await browser.newPage({ viewport: { height: 134, width: 720 } });
  try {
    await page.setContent(
      `<style>${donorCss}</style><div class="widget-stream-stats"><div class="stats-list"><div class="stats-list-item"><div class="stats-item-main-row">Донатер</div></div></div></div>`,
    );
    const radius = await page.locator('.stats-list').evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ];
    });
    expect(radius[0]).not.toBe('0px');
    expect(radius[1]).not.toBe('0px');
    expect(radius.slice(2)).toEqual(['0px', '0px']);
  } finally {
    await page.close();
  }
});
