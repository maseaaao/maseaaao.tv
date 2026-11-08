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

test.each([
  [480, 36, 24],
  [640, 55, 32],
  [1080, 55, 48],
])('shorter horizontal strip %i×%i preserves %i px text', async (width, height, size) => {
  const page = await browser.newPage({ viewport: { height, width } });
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
    expect(await page.locator('.name').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      `${size}px`,
    );
    const bounds = await page.locator('.name').boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) {
      throw new Error('Missing nickname');
    }
    expect(bounds.y).toBeGreaterThanOrEqual(1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 1);
  } finally {
    await page.close();
  }
});

test('accent typography stays Unbounded 400 while the brand nickname uses 600', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
    const nickname = await page.locator('.name').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontFamily, style.fontWeight];
    });
    expect(nickname[0]).toContain('Unbounded');
    expect(nickname[1]).toBe('600');

    await page.setContent(
      `<style>${donorCss}</style><div class="widget-stream-stats"><div class="stats-list"><div class="stats-list-item"><div class="stats-item-main-row">Донатер</div><div class="stats-item-additional-row">100 RUB</div></div></div></div><p id="accent" style="font:400 24px var(--font-display)">Заголовок</p><p id="body" style="font:400 16px var(--font-body)">Основной текст</p>`,
    );
    const typography = await page
      .locator('.stats-item-main-row, #accent, #body')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            body: element.id === 'body',
            family: style.fontFamily,
            weight: style.fontWeight,
          };
        }),
      );
    expect(typography).toHaveLength(3);
    for (const style of typography) {
      expect(style.family).toContain(style.body ? 'Arial' : 'Unbounded');
      if (style.body) {
        expect(style.family).not.toContain('Unbounded');
      }
      expect(style.weight).toBe('400');
    }
  } finally {
    await page.close();
  }
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

test.each(['no-preference', 'reduce'] as const)(
  'social icons stay still regardless of OS motion setting %s',
  async (reducedMotion) => {
    const page = await browser.newPage({
      reducedMotion,
      viewport: { height: 64, width: 720 },
    });
    try {
      await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
      const icons = await page.locator('.logo').evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            animations: element.getAnimations().length,
            name: style.animationName,
            opacity: style.opacity,
            transform: style.transform,
          };
        }),
      );
      expect(icons).toEqual(
        Array.from({ length: 5 }, () => ({
          animations: 0,
          name: 'none',
          opacity: '0.82',
          transform: 'none',
        })),
      );
    } finally {
      await page.close();
    }
  },
);

test.each([
  [720, 'list'],
  [720, 'slider'],
  [1100, 'list'],
  [1100, 'slider'],
] as const)('long donor fits %i px %s and keeps roll timing', async (width, mode) => {
  const page = await browser.newPage({
    reducedMotion: 'reduce',
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

test('goal strip shows the follower goal and progress', async () => {
  const page = await browser.newPage({ viewport: { height: 36, width: 480 } });
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html?goal=1&demo=1`);
    expect(await page.locator('.goal-count').textContent()).toBe('18/20');
    const progress = await page.locator('.goal-line i').evaluate((element) => {
      const line = element.parentElement;
      return line ? element.getBoundingClientRect().width / line.getBoundingClientRect().width : 0;
    });
    expect(progress).toBeCloseTo(0.9, 2);
    const fill = await page.locator('.goal-line').boundingBox();
    expect(fill?.height).toBeGreaterThan(30);
    expect(
      await page.locator('.goal-count').evaluate((element) => getComputedStyle(element).fontWeight),
    ).toBe('600');
    expect(await page.locator('.divider--goal').isVisible()).toBe(true);
    expect(await page.locator('.goal-block').isHidden()).toBe(true);
  } finally {
    await page.close();
  }
});

test('goal block shows current, target, remaining and progress', async () => {
  const page = await browser.newPage({ viewport: { height: 90, width: 720 } });
  try {
    await page.goto(
      `${server.resolvedUrls?.local[0]}src/social-strip/index.html?layout=goal&demo=1`,
    );
    expect(await page.locator('.strip').isHidden()).toBe(true);
    expect(await page.locator('.goal-block__current').textContent()).toBe('18');
    expect(await page.locator('.goal-block__target').textContent()).toBe('/20');
    expect(await page.locator('.goal-block__left').textContent()).toBe('ОСТАЛОСЬ 2');
    const progress = await page.locator('.goal-block__bar i').evaluate((element) => {
      const bar = element.parentElement;
      return bar ? element.getBoundingClientRect().width / bar.getBoundingClientRect().width : 0;
    });
    expect(progress).toBeCloseTo(0.9, 2);
  } finally {
    await page.close();
  }
});

test('goal stays hidden without the goal flag', async () => {
  const page = await browser.newPage({ viewport: { height: 88, width: 720 } });
  try {
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html`);
    expect(await page.locator('.goal-count').isHidden()).toBe(true);
    expect(await page.locator('.divider--goal').isHidden()).toBe(true);
    expect(await page.locator('.goal-line').isHidden()).toBe(true);
    expect(await page.locator('.goal-block').isHidden()).toBe(true);
  } finally {
    await page.close();
  }
});

test('goal block stays hidden until Streamer.bot supplies a valid goal', async () => {
  const page = await browser.newPage({ viewport: { height: 90, width: 720 } });
  try {
    await page.routeWebSocket('ws://127.0.0.1:8080', () => {
      // Connected, but no goal has arrived yet.
    });
    await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html?layout=goal`);
    expect(await page.locator('.goal-block').isHidden()).toBe(true);
  } finally {
    await page.close();
  }
});

test('goal ignores unsupported password query without sending authentication', async () => {
  const page = await browser.newPage();
  const requests: string[] = [];
  try {
    await page.clock.install();
    let polls = 0;
    await page.routeWebSocket('ws://127.0.0.1:8080', (socket) => {
      socket.onMessage((message) => {
        requests.push(String(message));
        if (JSON.parse(String(message)).request === 'GetGlobals') {
          polls += 1;
          socket.send(
            JSON.stringify({ variables: { twitchGoal: { current: polls, target: 20 } } }),
          );
        }
      });
    });
    await page.goto(
      `${server.resolvedUrls?.local[0]}src/social-strip/index.html?goal=1&password=fixture-only`,
    );
    await page.waitForFunction(() => document.querySelector('.goal-current')?.textContent === '1');
    await page.clock.fastForward(30_000);
    await page.waitForFunction(() => document.querySelector('.goal-current')?.textContent === '2');
    expect(requests.some((message) => JSON.parse(message).request === 'Authentication')).toBe(
      false,
    );
    expect(requests.join('\n')).not.toContain('fixture-only');
    expect(requests.map((message) => JSON.parse(message).request)).toEqual([
      'DoAction',
      'GetGlobals',
      'DoAction',
      'GetGlobals',
    ]);
  } finally {
    await page.close();
  }
});

test.each([
  [480, 36, 'goal=1'],
  [1080, 55, 'goal=1'],
  [1080, 88, 'goal=1'],
  [560, 90, 'layout=goal'],
  [720, 90, 'layout=goal'],
] as const)(
  'live goal response renders at %i×%i (%s)',
  async (width: number, height: number, query: string) => {
    const page = await browser.newPage({ viewport: { height, width } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.clock.install();
      let goal = JSON.stringify({ current: 7, target: 25, type: 'follower' });
      await page.routeWebSocket('ws://127.0.0.1:8080', (socket) => {
        socket.onMessage((message) => {
          const request = JSON.parse(String(message));
          if (request.request === 'GetGlobals') {
            socket.send(
              JSON.stringify({
                id: request.id,
                status: 'ok',
                variables: { twitchGoal: { name: 'twitchGoal', value: goal } },
              }),
            );
          }
        });
      });
      await page.goto(`${server.resolvedUrls?.local[0]}src/social-strip/index.html?${query}`);
      const current = query === 'goal=1' ? '.goal-current' : '.goal-block__current';
      const target = query === 'goal=1' ? '.goal-target' : '.goal-block__target';
      await page.waitForFunction(
        (selector) => document.querySelector(selector)?.textContent === '7',
        current,
      );
      expect(await page.locator(target).textContent()).toBe('/25');
      await page.evaluate(() => document.fonts.ready);
      const root = query === 'goal=1' ? '.strip' : '.goal-block';
      const metrics = await page.locator(root).evaluate((element) => ({
        children: Array.from(element.children)
          .filter((child) => child.getBoundingClientRect().height > 0)
          .map((child) => child.getBoundingClientRect().toJSON()),
        scrollWidth: element.scrollWidth,
        width: element.clientWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
      for (const child of metrics.children) {
        expect(child.top).toBeGreaterThanOrEqual(0);
        expect(child.bottom).toBeLessThanOrEqual(height);
      }
      goal = JSON.stringify({ current: 8, target: 25, type: 'follower' });
      await page.clock.fastForward(30_000);
      await page.waitForFunction(
        (selector) => document.querySelector(selector)?.textContent === '8',
        current,
      );
      goal = '';
      await page.clock.fastForward(30_000);
      await page.waitForFunction(
        (selector) => document.querySelector<HTMLElement>(selector)?.hidden,
        query === 'goal=1' ? '.goal-count' : '.goal-block',
      );
      expect(await page.locator('.goal-line').isHidden()).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
);
