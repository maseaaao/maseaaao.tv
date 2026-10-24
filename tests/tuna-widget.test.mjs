import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, afterEach, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

let browser;
before(async () => {
  browser = await launchBrowser();
});
afterEach(async () => {
  if (browser) await Promise.all(browser.contexts().map((context) => context.close()));
});
after(async () => {
  await browser?.close();
});

for (const reduced of [false, true])
  test(`soft track changes keep the backing still and coalesce rapid metadata (reduced: ${reduced})`, async () => {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 200 },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    let track = { title: 'Первый трек', artist: 'Первый исполнитель', playing: true };
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://localhost:1608/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(track),
      }),
    );
    await page.goto(
      new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url).href +
        '?opaque=1&reveal=soft&poll=100&anim=420&start=600000&show=600000',
    );
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#content')).opacity === '1',
    );
    await page.waitForTimeout(450);
    const frames = page.evaluate(async () => {
      const result = [],
        start = performance.now();
      while (performance.now() - start < 1100) {
        await new Promise(requestAnimationFrame);
        const surface = getComputedStyle(document.querySelector('#surface'));
        const texts = [...document.querySelectorAll('.track-text')].map((node) => ({
          title: node.querySelector('.track-title').textContent,
          opacity: Number(getComputedStyle(node).opacity),
        }));
        result.push({ opacity: surface.opacity, transform: surface.transform, texts });
      }
      return result;
    });
    track = { title: 'Второй трек', artist: '', playing: true };
    await page.waitForFunction(
      () => document.querySelector('#title').textContent === 'Второй трек',
    );
    track = { title: 'Третий трек', artist: 'Третий исполнитель', playing: true };
    await page.waitForFunction(
      () => document.querySelector('#title').textContent === 'Третий трек',
    );
    track = { title: 'Последний трек', artist: 'Последний исполнитель', playing: true };
    const samples = await frames;
    await page.waitForFunction(
      () => document.querySelector('#title').textContent === 'Последний трек',
    );
    await page.waitForFunction(() => document.querySelectorAll('.track-text').length === 1);
    assert(samples.every((f) => f.opacity === '1' && f.transform === 'matrix(1, 0, 0, 1, 0, 0)'));
    assert(
      samples.every(
        (f) => f.texts.length <= 2 && f.texts.reduce((n, t) => n + t.opacity, 0) > 0.98,
      ),
      'No accumulating text layers or empty text frame',
    );
    assert.equal(
      samples.some((f) => f.texts.some((t) => t.opacity > 0 && t.opacity < 1)),
      !reduced,
    );
    assert.equal(await page.locator('[id="title"]').count(), 1, 'Cloned text has no duplicate IDs');
    assert.equal(await page.locator('#subtitle').textContent(), 'Последний исполнитель');
    track = { title: 'Трек перед паузой', artist: '', playing: true };
    await page.waitForFunction(
      () => document.querySelector('#title').textContent === 'Трек перед паузой',
    );
    track = { ...track, playing: false };
    await page.waitForFunction(() => document.querySelector('#player').dataset.play === '0');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.track-text').count(), 1);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    assert.equal(await page.locator('#subtitle').isHidden(), true);
    assert.deepEqual(errors, []);
  });

test('soft cover changes retain the loaded image, reject stale loads and fall back after bounded failures', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 200 } });
  const cover = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#1a12d3' },
  })
    .png()
    .toBuffer();
  let track = { title: 'A', cover_url: '/a.png', playing: true };
  let releaseB, receivedB;
  const blockedB = new Promise((resolve) => {
    releaseB = resolve;
  });
  const requestedB = new Promise((resolve) => {
    receivedB = resolve;
  });
  const failures = [];
  try {
    await page.route('http://localhost:1608/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/')
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(track),
        });
      if (url.pathname === '/b.png') {
        receivedB();
        await blockedB;
      }
      if (url.pathname === '/missing.png') {
        failures.push(url.href);
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fulfill({ contentType: 'image/png', body: cover });
    });
    await page.goto(
      new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url).href +
        '?opaque=1&reveal=soft&poll=100&anim=420&art=0&swap=280&tries=2&retry=100&start=600000&show=600000',
    );
    await page.waitForFunction(() =>
      document.querySelector('.cover-image.is-active')?.src.includes('/a.png'),
    );
    await page.waitForTimeout(600);
    track = { title: 'B', cover_url: '/b.png', playing: true };
    await requestedB;
    await page.waitForTimeout(150);
    assert(
      (await page.locator('.cover-image.is-active').getAttribute('src')).includes('/a.png'),
      'A remains visible while B is delayed',
    );
    assert.equal(await page.locator('#player').getAttribute('data-cover'), '1');
    track = { title: 'C', cover_url: '/c.png', playing: true };
    await page.waitForFunction(() =>
      document.querySelector('.cover-image.is-active')?.src.includes('/c.png'),
    );
    assert(
      Number(
        await page.locator('.cover-image.is-active').evaluate((e) => getComputedStyle(e).opacity),
      ) < 1,
      'A replacement cover crossfades',
    );
    releaseB();
    await page.waitForTimeout(500);
    assert(
      (await page.locator('.cover-image.is-active').getAttribute('src')).includes('/c.png'),
      'The late B image cannot overwrite C',
    );
    track = { title: 'D', cover_url: '/missing.png', playing: true };
    await page.waitForFunction(() => document.querySelector('#player').dataset.cover === '0');
    await page.waitForTimeout(700);
    assert.equal(failures.length, 2, 'The attempt limit and cooldown still apply');
    assert.notEqual(failures[0], failures[1]);
    assert.equal(
      await page.locator('.cover-image.is-active').count(),
      0,
      'No stale C artwork on D',
    );
    track = { title: 'E', cover_url: '/e.png', playing: true };
    await page.waitForFunction(() =>
      document.querySelector('.cover-image.is-active')?.src.includes('/e.png'),
    );
    track = { title: 'F', cover_url: '', playing: true };
    await page.waitForFunction(() => document.querySelector('#player').dataset.cover === '0');
  } finally {
    releaseB();
  }
});

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
    const directory = await mkdtemp(join(tmpdir(), 'tuna-delivery-'));
    let page;
    try {
      const file = join(directory, 'tuna.html');
      await cp(new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url), file);
      page = await browser.newPage({
        viewport: { width: 1000, height: 134 },
        colorScheme: 'dark',
      });
      let playing = true;
      const requests = [],
        errors = [];
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
      await page.goto(pathToFileURL(file).href + query);
      await page.waitForFunction(() => document.querySelector('#player').dataset.play === '1');
      assert.equal(await page.locator('#title').textContent(), 'Тестовый трек');
      assert((await page.locator('#subtitle').textContent()).includes('Тестовый исполнитель'));
      await page.evaluate(() => document.fonts.ready);
      assert(await page.evaluate(() => document.fonts.check('400 20px Unbounded')));
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
      await page?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

for (const [reduced, forceMotion] of [
  [false, false],
  [true, false],
  [true, true],
])
  test(`soft presence protects underlying donor text and handles reversals (reduced: ${reduced}, explicit: ${forceMotion})`, async () => {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 200 },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    let playing = false;
    let title = 'Первый трек';
    const animated = !reduced || forceMotion;
    const sample = async (duration) =>
      page.evaluate(async (duration) => {
        const frames = [];
        const start = performance.now();
        await new Promise((resolve) => {
          const tick = () => {
            const surface = getComputedStyle(document.querySelector('#surface'));
            const pose = new DOMMatrixReadOnly(surface.transform);
            frames.push({
              surface: Number(surface.opacity),
              content: Number(getComputedStyle(document.querySelector('#content')).opacity),
              cover: Number(getComputedStyle(document.querySelector('#cover-frame')).opacity),
              scaleX: pose.a,
              offset: pose.f,
              rootBackground: getComputedStyle(document.querySelector('#player')).backgroundColor,
            });
            if (performance.now() - start >= duration) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return frames;
      }, duration);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:')) return route.continue();
      if (!url.startsWith('http://localhost:1608/')) return route.abort();
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ title, artist: 'Исполнитель', playing }),
      });
    });
    await page.goto(
      pathToFileURL(resolve(import.meta.dirname, '../apps/tuna-widget/dist/obs-tuna-widget.html'))
        .href +
        `?opaque=1&reveal=soft&poll=100&anim=420&start=600000&show=250&idle=0${forceMotion ? '&motion=1' : ''}`,
    );
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#surface').evaluate((e) => getComputedStyle(e).opacity), '0');
    playing = true;
    await page.waitForFunction(() => document.querySelector('#player').dataset.play === '1');
    const entering = await sample(animated ? 500 : 120);
    assert.equal(entering.at(-1).surface, 1);
    assert.equal(entering.at(-1).content, 1);
    assert.equal(entering.at(-1).scaleX, 1);
    if (animated) {
      assert(
        entering.some((f) => f.surface > 0 && f.surface < 1),
        'Material emerges gradually',
      );
      assert(
        entering.some((f) => f.scaleX < 0.999),
        'Material settles with a small scale change',
      );
    }
    const visible = await sharp(await page.screenshot({ omitBackground: true }))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(visible.data[(100 * visible.info.width + 4) * 4 + 3], 255);
    assert.equal(visible.data[(5 * visible.info.width + 5) * 4 + 3], 0);
    playing = false;
    await page.waitForFunction(() => document.querySelector('#player').dataset.play === '0');
    const leaving = await sample(animated ? 175 : 30);
    playing = true;
    title = 'Новый трек во время ухода';
    await page.waitForFunction(
      () => document.querySelector('#title').textContent === 'Новый трек во время ухода',
    );
    const returning = await sample(animated ? 500 : 120);
    assert.equal(returning.at(-1).surface, 1);
    assert.equal(returning.at(-1).content, 1);
    const idling = await sample(700);
    assert.equal(idling.at(-1).surface, 0, 'Idle returns the widget to transparent space');
    assert.equal(idling.at(-1).content, 0);
    for (const f of [...entering, ...leaving, ...returning, ...idling]) {
      assert.equal(f.rootBackground, 'rgba(0, 0, 0, 0)');
      assert(
        f.scaleX >= 0.967 && f.scaleX <= 1.003,
        'Spring stays within 0.3% overshoot; no full-card slide',
      );
      if (f.content > 0.001 || f.cover > 0.001)
        assert(f.surface >= 0.999, 'Text/art only appear over an opaque backing');
    }
    const hidden = await sharp(await page.screenshot({ omitBackground: true }))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(hidden.data[(100 * hidden.info.width + 500) * 4 + 3], 0);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  });

test('Tuna keeps bounded cover retries, recovers on a new cover and fits its light transparent delivery', {
  timeout: 30000,
}, async () => {
  const page = await browser.newPage({ viewport: { width: 540, height: 108 } });
  const attempts = [];
  let cover = '/missing-cover.png';
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=',
    'base64',
  );
  await page.clock.install();
  const retry = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/missing-cover.png' && url.searchParams.get('_tuna')?.endsWith('-1');
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'file:') return route.continue();
    if (url.hostname !== 'localhost' || url.port !== '1608') return route.abort();
    if (url.pathname === '/missing-cover.png') {
      attempts.push(url.href);
      return route.abort();
    }
    if (url.pathname === '/valid-cover.png')
      return route.fulfill({ contentType: 'image/png', body: pixel });
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        title: 'Длинное название композиции для узкого источника',
        artist: 'Тестовый исполнитель',
        playing: true,
        cover_url: cover,
      }),
    });
  });
  await page.goto(
    new URL('../apps/tuna-widget/dist/obs-tuna-widget.html', import.meta.url).href +
      '?art=0&retry=100&tries=2&poll=100&anim=0&swap=0&start=600000',
  );
  await retry;
  await page.clock.runFor(1000);
  assert.equal(
    attempts.length,
    2,
    'The configured cover attempt limit is respected during cooldown',
  );
  assert.notEqual(attempts[0], attempts[1], 'Each local attempt receives a new cache-busting URL');
  assert.equal(await page.locator('#player').getAttribute('data-cover'), '0');
  cover = '/valid-cover.png';
  await page.clock.runFor(200);
  await page.waitForFunction(() => document.querySelector('#player').dataset.cover === '1');
  assert.equal(
    await page.locator('.cover-image.is-active').evaluate((image) => image.naturalWidth),
    1,
  );
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 390, 540, 1000]) {
    await page.setViewportSize({ width, height: 108 });
    const result = await page.evaluate(() => {
      const player = document.querySelector('#player');
      const content = document.querySelector('#content').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        outside: getComputedStyle(document.body).backgroundColor,
        surface: getComputedStyle(player).backgroundColor,
        text: getComputedStyle(document.querySelector('#title')).color,
        weight: getComputedStyle(document.querySelector('#title')).fontWeight,
        glow: [...document.querySelectorAll('.artwork-glow')].every(
          (image) => getComputedStyle(image).display === 'none',
        ),
        contentFits: content.x >= 0 && content.right <= innerWidth,
      };
    });
    assert.deepEqual(
      result,
      {
        overflow: false,
        outside: 'rgba(0, 0, 0, 0)',
        surface: 'rgb(244, 243, 236)',
        text: 'rgb(32, 32, 30)',
        weight: '400',
        glow: true,
        contentFits: true,
      },
      `${width}px`,
    );
  }
  const screenshot = await page.screenshot({ omitBackground: true });
  const { data, info } = await sharp(screenshot)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'The outer rounded corner remains transparent for OBS');
  assert.equal(
    data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3],
    255,
    'The playing surface remains opaque',
  );
});

test('Tuna exposes opt-in local debugging without changing the visual overlay', async () => {
  const page = await browser.newPage({
    viewport: { width: 420, height: 82 },
  });
  const messages = [];
  page.on('console', (message) => {
    if (message.type() === 'debug') messages.push(message.text());
  });
  await page.route(/^http:\/\/localhost:1608\//, (route) => route.abort());
  await page.goto(
    pathToFileURL(resolve(import.meta.dirname, '../apps/tuna-widget/dist/obs-tuna-widget.html'))
      .href + '?debug=1&poll=100&timeout=500&fail=1',
  );
  await page.waitForFunction(() => document.querySelector('#player').dataset.play === '0');
  await page.waitForTimeout(650);
  assert(messages.some((line) => line.includes('[tuna-widget] poll failed')));
  assert.equal(await page.locator('#title').textContent(), '');
});

for (const [reduced, forceMotion] of [
  [false, false],
  [true, false],
  [true, true],
])
  test(`opaque shared-slot transitions never fade the panel (reduced: ${reduced}, explicit motion: ${forceMotion})`, async () => {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 200 },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    let playing = false;
    let title = 'Первый трек';
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:')) return route.continue();
      if (!url.startsWith('http://localhost:1608/')) return route.abort();
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ title, artists: ['Исполнитель'], playing }),
      });
    });
    await page.goto(
      pathToFileURL(resolve(import.meta.dirname, '../apps/tuna-widget/dist/obs-tuna-widget.html'))
        .href +
        `?opaque=1&poll=100&anim=300&start=250&show=250&idle=0${forceMotion ? '&motion=1' : ''}`,
    );
    await page.evaluate(() => document.fonts.ready);
    const hidden = await sharp(await page.screenshot({ omitBackground: true }))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(hidden.data[(100 * hidden.info.width + 500) * 4 + 3], 0);
    playing = true;
    const frames = await page.evaluate(async () => {
      const samples = [];
      const start = performance.now();
      await new Promise((done) => {
        const tick = () => {
          const s = getComputedStyle(document.querySelector('#player'));
          samples.push({ opacity: s.opacity, offset: new DOMMatrixReadOnly(s.transform).m42 });
          if (performance.now() - start > 1150) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return samples;
    });
    assert(
      frames.every((f) => f.opacity === '1'),
      'Music never blends with donors underneath',
    );
    assert(
      frames.some((f) => Math.abs(f.offset) < 0.01),
      'Panel fully opens',
    );
    assert(Math.abs(frames.at(-1).offset - 200) < 0.01, 'Idle conceals the panel');
    if (!reduced || forceMotion)
      assert(
        frames.some((f) => {
          return f.offset > 2 && f.offset < 198;
        }),
        'Normal motion reveals the panel gradually',
      );
    title = 'Второй трек';
    await page.waitForFunction(
      () => document.querySelector('#title').textContent === 'Второй трек',
    );
    await page.waitForFunction(
      () =>
        Math.abs(
          new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#player')).transform).m42,
        ) < 0.01,
    );
    const visible = await sharp(await page.screenshot({ omitBackground: true }))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(
      visible.data[(100 * visible.info.width + 4) * 4 + 3],
      255,
      'Visible panel is opaque',
    );
    assert.equal(
      visible.data[(5 * visible.info.width + 5) * 4 + 3],
      0,
      'Surface corners remain rounded',
    );
    if (!reduced || forceMotion) {
      await page.waitForFunction(() => {
        const amount = new DOMMatrixReadOnly(
          getComputedStyle(document.querySelector('#player')).transform,
        ).m42;
        return amount > 20 && amount < 180;
      });
      title = 'Трек во время сворачивания';
      await page.waitForFunction(
        () => document.querySelector('#title').textContent === 'Трек во время сворачивания',
      );
      await page.waitForFunction(
        () =>
          Math.abs(
            new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#player')).transform)
              .m42,
          ) < 0.01,
      );
      assert.equal(await page.locator('#player').evaluate((e) => getComputedStyle(e).opacity), '1');
    }
    playing = false;
    await page.waitForFunction(() => document.querySelector('#player').dataset.play === '0');
    await page.waitForFunction(
      () =>
        Math.abs(
          new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#player')).transform).m42 -
            200,
        ) < 0.01,
    );
  });
