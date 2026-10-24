import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
import { build } from 'vite';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

// Fresh source -> standalone file:// in real Chromium. Only Tuna HTTP/cover peers are fixtures.
// This does not claim compatibility with live OBS CEF, or contact the user's Tuna server.
const root = resolve(import.meta.dirname, '..');
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=',
  'base64',
);
let directory, file, browser;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tuna-acceptance-'));
  await symlink(resolve(root, 'node_modules'), join(directory, 'node_modules'), 'junction');
  const config = standaloneConfig({
    root: resolve(root, 'apps/tuna-widget/src'),
    outDir: join(directory, 'delivery'),
    fileName: 'obs-tuna-widget.html',
    budgets: { html: 200000, js: 12000 },
  });
  config.build.modulePreload = false;
  await build({ ...config, configFile: false });
  file = pathToFileURL(join(directory, 'delivery/obs-tuna-widget.html')).href;
  assert(
    (await readFile(join(directory, 'delivery/obs-tuna-widget.html'), 'utf8')).includes(
      'data:font/woff2;base64,',
    ),
  );
  browser = await launchBrowser();
  console.log(
    `Tuna acceptance: ${browser.version()} / ${process.platform} / file:// native image decoding + fetch`,
  );
});
after(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 82 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No uncaught browser errors'));
  let track = { title: 'Трек A', artist: 'Исполнитель', playing: true };
  let api = 'online';
  let polls = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'file:') return route.continue();
    requests.push(url);
    if (url.hostname !== 'localhost' && url.hostname !== 'covers.example.test')
      return route.abort();
    if (url.hostname === 'localhost' && url.pathname === '/') {
      polls++;
      if (api === 'offline') return route.abort('internetdisconnected');
      if (api === '404') return route.fulfill({ status: 404, body: 'not found' });
      if (api === 'timeout') return; // Browser AbortController must abort the real fetch.
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(track),
      });
    }
    if (options.cover) return options.cover(route, url);
    return route.fulfill({ contentType: 'image/png', body: pixel });
  });
  const query =
    options.query ?? 'poll=100&art=0&anim=0&swap=0&start=600000&show=600000&retry=100&tries=2';
  await page.goto(file + '?' + query);
  return {
    page,
    requests,
    setTrack: (next) => {
      track = next;
    },
    setApi: (next) => {
      api = next;
    },
    polls: () => polls,
  };
}
async function waitForPolls(fixture, count) {
  const deadline = Date.now() + 5000;
  while (fixture.polls() < count && Date.now() < deadline) await fixture.page.waitForTimeout(10);
  assert(fixture.polls() >= count, `Expected ${count} API polls within 5 seconds`);
}
async function playing(page, value = '1') {
  await page.waitForFunction(
    (value) => document.querySelector('#player').dataset.play === value,
    value,
  );
}
async function coverReady(page, pathname) {
  await page.waitForFunction(
    (pathname) => {
      const image = document.querySelector('.cover-image.is-active');
      return image?.naturalWidth > 0 && new URL(image.src).pathname === pathname;
    },
    pathname,
    { timeout: 9000 },
  );
}

test('pause hides immediately; resume of the same track restores visibility and the existing cover', async (t) => {
  const f = await setup(t);
  f.setTrack({
    title: 'Трек A',
    artists: [{ name: 'Исполнитель' }],
    playing: true,
    cover_url: '/a.png',
  });
  await playing(f.page);
  await coverReady(f.page, '/a.png');
  f.setTrack({ title: 'Трек A', artist: 'Исполнитель', playing: false, cover_url: '/a.png' });
  await playing(f.page, '0');
  assert.equal(await f.page.locator('#player').evaluate((p) => getComputedStyle(p).opacity), '0');
  const before = f.requests.filter((url) => url.pathname === '/a.png').length;
  f.setTrack({ title: 'Трек A', artist: 'Исполнитель', playing: true, cover_url: '/a.png' });
  await playing(f.page);
  assert.equal(await f.page.locator('#player').evaluate((p) => getComputedStyle(p).opacity), '1');
  assert.equal(await f.page.locator('#subtitle').textContent(), 'Исполнитель');
  assert.equal(f.requests.filter((url) => url.pathname === '/a.png').length, before);
});

test('a slow cover A arriving after track B cannot replace B or revive the old slot', async (t) => {
  let slowRoute;
  const f = await setup(t, {
    cover: async (route, url) => {
      if (url.pathname === '/slow-a.png') {
        slowRoute = route;
        return;
      }
      return route.fulfill({ contentType: 'image/png', body: pixel });
    },
  });
  const arrived = f.page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/slow-a.png',
  );
  f.setTrack({ title: 'Медленный A', playing: true, cover_url: '/slow-a.png' });
  await arrived;
  f.setTrack({ title: 'Быстрый B', playing: true, cover_url: '/fast-b.png' });
  await coverReady(f.page, '/fast-b.png');
  await slowRoute.fulfill({ contentType: 'image/png', body: pixel });
  await f.page.waitForFunction(
    () => ![...document.images].some((image) => image.src.includes('slow-a')),
  );
  // Wait through more than one complete poll + slot cleanup, not only the first paint of B.
  const currentPoll = f.polls();
  await f.page.waitForFunction(() => document.querySelector('#title').textContent === 'Быстрый B');
  await waitForPolls(f, currentPoll + 2);
  await coverReady(f.page, '/fast-b.png');
  assert.equal(await f.page.locator('.cover-image.is-active').count(), 1);
});

test('404 cover respects tries/retry cooldown and recovers at the same URL after cooldown', async (t) => {
  let available = false;
  const attempts = [];
  const f = await setup(t, {
    cover: (route, url) => {
      // Preload and the two visible image slots may request the same URL.
      // A retry is a new cache-busted URL, not another consumer of one attempt.
      if (!attempts.some((attempt) => attempt.href === url.href)) {
        attempts.push({ href: url.href, time: Date.now() });
      }
      return available
        ? route.fulfill({ contentType: 'image/png', body: pixel })
        : route.fulfill({ status: 404, body: 'missing' });
    },
  });
  f.setTrack({ title: 'Обложка появится позже', playing: true, cover_url: '/eventual.png' });
  await f.page.waitForRequest(
    (r) => new URL(r.url()).searchParams.get('_tuna')?.endsWith('-1') === true,
  );
  await f.page.waitForTimeout(350);
  assert.equal(attempts.length, 2);
  assert(attempts[1].time - attempts[0].time >= 90, 'retry delay is not skipped');
  assert.notEqual(attempts[0].href, attempts[1].href);
  assert.equal(await f.page.locator('#player').getAttribute('data-cover'), '0');
  available = true;
  await coverReady(f.page, '/eventual.png');
  assert.equal(attempts.length, 3);
  assert(attempts[2].time - attempts[1].time >= 4900, 'cooldown prevents retry storms');
});

for (const failure of ['404', 'offline', 'timeout']) {
  test(`Tuna API ${failure} hides at fail threshold and recovers when the server returns`, async (t) => {
    const f = await setup(t, {
      query: 'poll=100&art=0&anim=0&start=600000&show=600000&fail=3&timeout=500',
    });
    await playing(f.page);
    f.setApi(failure);
    const previousPolls = f.polls();
    await waitForPolls(f, previousPolls + 2);
    assert.equal(
      await f.page.locator('#player').getAttribute('data-play'),
      '1',
      'Two lost polls do not blink',
    );
    await playing(f.page, '0');
    f.setApi('online');
    f.setTrack({ title: 'После восстановления', playing: true });
    await playing(f.page);
    assert.equal(await f.page.locator('#title').textContent(), 'После восстановления');
    assert.equal(await f.page.locator('#player').evaluate((p) => getComputedStyle(p).opacity), '1');
  });
}

test('static local cover gets verified on track change; signed remote query is preserved exactly', async (t) => {
  const f = await setup(t);
  f.setTrack({ title: 'A', playing: true, cover_url: '/cover.png?keep=1' });
  await coverReady(f.page, '/cover.png');
  const attempts = () =>
    new Set(f.requests.filter((url) => url.pathname === '/cover.png').map((url) => url.href));
  const first = attempts().size;
  f.setTrack({ title: 'B', playing: true, cover_url: '/cover.png?keep=1' });
  await f.page.waitForFunction(() => {
    const image = document.querySelector('.cover-image.is-active');
    return image?.naturalWidth > 0 && new URL(image.src).searchParams.get('_tuna')?.endsWith('-1');
  });
  assert.equal(attempts().size, first + 2);
  assert(
    f.requests
      .filter((url) => url.pathname === '/cover.png')
      .every((url) => url.searchParams.get('keep') === '1'),
  );
  const signed = 'https://covers.example.test/signed.png?sig=a%2Bb&expires=123';
  f.setTrack({ title: 'C', playing: true, cover_url: signed });
  await coverReady(f.page, '/signed.png');
  assert(f.requests.some((url) => url.href === signed));
  assert(
    f.requests
      .filter((url) => url.hostname === 'covers.example.test')
      .every((url) => !url.searchParams.has('_tuna')),
  );
});

for (const [query, port, img, swap] of [
  [
    'port=1688&poll=100&art=0&anim=0&img=0.75&ui=1.25&swap=123&start=600000',
    '1688',
    '0.75',
    '123ms',
  ],
  [
    'port=not-a-number&poll=-1&art=0&anim=0&img=99&ui=99&swap=-1&start=600000',
    '1608',
    '1.5',
    '0ms',
  ],
]) {
  test(`query parameters and resize stay bounded: ${query}`, async (t) => {
    const f = await setup(t, { query });
    await playing(f.page);
    assert(f.requests.filter((url) => url.pathname === '/').every((url) => url.port === port));
    assert.equal(
      await f.page.evaluate(() => document.documentElement.style.getPropertyValue('--img')),
      img,
    );
    assert.equal(
      await f.page.evaluate(() => document.documentElement.style.getPropertyValue('--art-swap')),
      swap,
    );
    for (const [width, height] of [
      [320, 82],
      [390, 108],
      [540, 134],
      [1000, 200],
    ]) {
      await f.page.setViewportSize({ width, height });
      await f.page.waitForFunction(() => {
        const bounds = document.querySelector('#content').getBoundingClientRect();
        return bounds.left >= -0.5 && bounds.right <= innerWidth + 0.5;
      });
      assert.equal(
        await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert(
        await f.page.evaluate(
          () => Number(document.documentElement.style.getPropertyValue('--scale')) > 0,
        ),
      );
    }
  });
}

test('start/show/idle timing and reduced-motion preserve pause/resume semantics', async (t) => {
  const f = await setup(t, {
    query: 'poll=100&art=0&anim=0&start=200&show=2000&idle=0.25&swap=123',
  });
  await playing(f.page);
  await f.page.waitForFunction(
    () => getComputedStyle(document.querySelector('#player')).opacity === '0.25',
  );
  f.setTrack({ title: 'Смена', playing: true });
  await f.page.waitForFunction(() => document.querySelector('#title').textContent === 'Смена');
  assert.equal(await f.page.locator('#player').evaluate((p) => getComputedStyle(p).opacity), '1');
  await f.page.waitForFunction(
    () => getComputedStyle(document.querySelector('#player')).opacity === '0.25',
  );
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.reload();
  await playing(f.page);
  assert.equal(
    await f.page.evaluate(() => document.documentElement.style.getPropertyValue('--art-swap')),
    '0ms',
  );
});
