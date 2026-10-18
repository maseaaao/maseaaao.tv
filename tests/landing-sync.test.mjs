import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {launchBrowser} from '../scripts/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamRef = '636683ebd6aec6e5a456baabf111865dc1c46cfd';
const upstream = file => execFileSync('git', ['show', `${upstreamRef}:${file}`], {cwd: root});
const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
const css = await fs.readFile(path.join(root, 'dist/assets/site.css'), 'utf8');
let browser, server, origin;

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + decodeURIComponent(name));
      if (!file.startsWith(root + path.sep)) throw Error('invalid path');
      res.setHeader('Content-Type', ({'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png'})[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

// Preserve the upstream player lifecycle with only two approved chat-default changes.
// Only Twitch SDK/iframe networking is substituted; no live messages/events escape.
const sdk = `(() => {
  class Player {
    static READY='ready'; static ONLINE='online'; static OFFLINE='offline';
    static PLAYBACK_BLOCKED='blocked'; static PLAYING='playing';
    constructor(id, options) {
      this.handlers={}; this.options=options; this.calls=[];
      window.__twitchPlayer=this;
      const frame=document.createElement('iframe'); frame.src='https://player.twitch.tv/?mock=1';
      frame.width='100%'; frame.height='100%'; document.getElementById(id).replaceChildren(frame);
    }
    addEventListener(name, fn) { (this.handlers[name]??=[]).push(fn); }
    emit(name) { for(const fn of this.handlers[name]??[]) fn(); }
    setMuted(value) { this.calls.push(['setMuted',value]); }
    play() { this.calls.push(['play']); }
  }
  window.Twitch={Player};
})();`;

async function newPage({width = 1440, sdkState = 'mock', javaScriptEnabled = true, htmlOverride, cssOverride, clock = false, colorScheme = "light"} = {}) {
  const context = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce', javaScriptEnabled, colorScheme});
  const page = await context.newPage();
  const traffic = {fonts: [], errors: [], external: []};
  page.on('pageerror', error => traffic.errors.push(error.message));
  page.on('response', response => {
    if (/\.(ttf|woff2?)(\?|$)/.test(response.url())) traffic.fonts.push({url: response.url(), status: response.status()});
  });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/dist/index.html' && htmlOverride) return route.fulfill({contentType: 'text/html; charset=utf-8', body: htmlOverride});
    if (url === origin + '/dist/assets/site.css' && cssOverride) return route.fulfill({contentType: 'text/css', body: cssOverride});
    if (url.startsWith(origin + '/')) return route.continue();
    traffic.external.push(url);
    if (url === 'https://player.twitch.tv/js/embed/v1.js') {
      if (sdkState === 'error') return route.abort('failed');
      if (sdkState === 'constructor-error') return route.fulfill({contentType: 'application/javascript', body: 'window.Twitch={Player:class {constructor(){throw Error("isolated constructor failure")}}};'});
      if (sdkState === 'missing') return route.fulfill({contentType: 'application/javascript', body: '/* missing SDK */'});
      return route.fulfill({contentType: 'application/javascript', body: sdk});
    }
    return route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Изолированный Twitch</title><body style="margin:0;background:#050608;color:#96a1b3;font:14px sans-serif">Изолированный Twitch: сеть подменена для аудита</body></html>'});
  });
  if (clock) await page.clock.install();
  await page.goto(origin + '/dist/index.html');
  if (javaScriptEnabled) await page.evaluate(() => document.fonts.ready);
  return {page, context, traffic};
}

async function chooseTheme(page, value) {
  await page.locator('.theme-trigger').click();
  await page.locator(`[data-theme-value="${value}"]`).click();
}

async function emit(page, ...names) {
  await page.waitForFunction(() => window.__twitchPlayer);
  await page.evaluate(names => names.forEach(name => window.__twitchPlayer.emit(name)), names);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function checkFeatures(source) {
  for (const feature of ['data-stream-layout', 'data-stream-status', 'data-live-badge', 'data-stream-offline', 'data-stream-player', 'data-player-summary', 'data-player-fallback', 'data-stream-chat', 'data-chat-frame', 'assets/stream.js', 'https://player.twitch.tv/', 'https://www.twitch.tv/embed/maseaaao/chat', 'https://www.twitch.tv/maseaaao/videos', 'https://www.tiktok.com/@maseaaao', 'aria-live="polite"']) {
    assert.ok(source.includes(feature), `Missing upstream feature: ${feature}`);
  }
}

test('merge conflict markers are absent from deployable HTML and CSS', () => {
  assert.doesNotMatch(html, /^(?:<{7}|={7}|>{7})/m);
  assert.doesNotMatch(css, /^(?:<{7}|={7}|>{7})/m);
});

test('upstream Twitch hooks, archive/TikTok links and accessibility survive', () => checkFeatures(html));
test('chat theme follows the page without recreating the Twitch player', async () => {
  const {page, context} = await newPage({colorScheme: 'dark'});
  try {
    await emit(page, 'ready', 'online');
    const source = async () => new URL(await page.locator('[data-chat-frame]').getAttribute('src'));
    assert.equal((await source()).searchParams.has('darkpopout'), true);
    await page.evaluate(() => { window.__originalPlayer = window.__twitchPlayer; });
    await chooseTheme(page, 'light');
    assert.equal((await source()).searchParams.has('darkpopout'), false);
    await chooseTheme(page, 'dark');
    assert.equal((await source()).searchParams.has('darkpopout'), true);
    assert.equal(await page.evaluate(() => window.__originalPlayer === window.__twitchPlayer), true);
    assert.equal((await source()).searchParams.get('parent'), '127.0.0.1');
  } finally { await context.close(); }
});

test('blue and light surfaces use a local accent font and rounded controls', async () => {
  const {page, context} = await newPage();
  try {
    const ui = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      surface: getComputedStyle(document.querySelector('.shell')).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
      loaded: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family),
      radius: getComputedStyle(document.querySelector('.tile')).borderRadius,
    }));
    assert.equal(ui.bg, 'rgb(22, 22, 217)');
    assert.equal(ui.surface, 'rgb(244, 243, 236)');
    assert.match(ui.font, /Arial/);
    assert.ok(ui.loaded.includes('Unbounded'));
    assert.equal(ui.loaded.length, 1);
    assert.equal(ui.radius, '12px');
  } finally { await context.close(); }
});

// Guard sensitivity: removing new hooks or restoring round upstream visuals
// really fails the same assertions, rather than silently rebasing regressions.
test('upstream feature contract rejects the pre-sync local landing', () => {
  const old = execFileSync('git', ['show', 'ca39891154536909ee85f30343dbaa075fcd2e02:dist/index.html'], {cwd: root, encoding: 'utf8'});
  assert.throws(() => checkFeatures(old), /Missing upstream feature/);
});


test('approved Twitch caption and donation label survive synchronization', () => {
  assert.ok(html.includes('Смотреть стримы'), 'lost local Twitch supporting copy');
  assert.ok(html.includes('Поддержать стрим'));
  assert.ok(!html.includes('Во время трансляции'));
});

function snapshotDOM() {
  const clean = document.body.cloneNode(true);
  clean.querySelectorAll('script,style').forEach(element => element.remove());
  return {
    anchors: [...document.querySelectorAll('a')].map(element => element.getAttribute('href')),
    head: [...document.querySelectorAll('head meta,head link:not([rel="stylesheet"])')].filter(element => element.getAttribute('name') !== 'theme-color').map(element => [element.tagName.toLowerCase(), Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]))]),
    title: document.title,
    text: clean.textContent.replace(/\s+/g, ''),
    scripts: [...document.querySelectorAll('script')].map(element => ({src: element.getAttribute('src'), defer: element.hasAttribute('defer'), text: element.textContent})),
  };
}

test('external destinations and executable scripts survive; approved copy and SEO are present', async () => {
  const current = await newPage({javaScriptEnabled: false});
  const reference = await newPage({javaScriptEnabled: false, htmlOverride: upstream('dist/index.html').toString('utf8')});
  try {
    const actual = await current.page.evaluate(snapshotDOM);
    const expected = await reference.page.evaluate(snapshotDOM);
    const destinations = anchors => [...new Set(anchors.filter(href => !href.startsWith('#')))].sort();
    assert.deepEqual(destinations(actual.anchors), destinations(expected.anchors));
    assert.equal(actual.title, expected.title);
    assert.deepEqual(actual.scripts.filter(script => script.src), [{src: 'assets/theme.js', defer: false, text: ''}, ...expected.scripts.filter(script => script.src)]);
    for (const copy of ['Стример и автор', 'Анонсы, новости, розыгрыши', 'Записи и нарезки', 'Поддержать стрим']) {
      assert.ok(actual.text.includes(copy.replace(/\s+/g, '')), copy);
    }
    assert.deepEqual(await current.page.locator('.tiles--secondary .tile__title').allTextContents(), ['Лобби', 'YouTube', 'Instagram', 'TikTok']);
    assert.equal(await current.page.locator('.tile--instagram .tile__meta,.tile--tiktok .tile__meta').count(), 0);
    assert.equal(await current.page.locator('[data-stream-status]').isVisible(), false);
    const profile = JSON.parse(await current.page.locator('script[type="application/ld+json"]').textContent());
    assert.equal(profile['@type'], 'ProfilePage');
    for (const link of profile.mainEntity.sameAs) assert.ok(actual.anchors.includes(link));
    assert.equal(await current.page.locator('link[rel="canonical"]').getAttribute('href'), 'https://maseaaao.tv/');
  } finally { await current.context.close(); await reference.context.close(); }
});

test('only the full-character-set local accent font is requested', async () => {
  const {page, context, traffic} = await newPage();
  try {
    const requests = traffic.fonts;
    assert.ok(requests.some(request => /\/unbounded-600\.[a-f0-9]{16}\.woff2$/.test(request.url)));
    for (const request of requests) { assert.equal(request.status, 200); assert.ok(request.url.startsWith(origin)); assert.doesNotMatch(request.url, /Inter/); }
    assert.deepEqual(traffic.errors, []);
  } finally { await context.close(); }
});

test('READY alone never invents LIVE; offline/live/playback-blocked transitions execute upstream script', async () => {
  const {page, context, traffic} = await newPage();
  try {
    await emit(page, 'ready');
    assert.equal(await page.evaluate(() => window.__twitchPlayer.options.autoplay), true);
    assert.equal(await page.evaluate(() => window.__twitchPlayer.options.muted), true);
    assert.equal(await page.locator('[data-stream-layout]').getAttribute('data-state'), 'loading');
    assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
    await emit(page, 'offline');
    assert.equal(await page.locator('[data-stream-layout]').getAttribute('data-state'), 'offline');
    assert.equal(await page.locator('[data-stream-offline]').isVisible(), false);
    assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
    assert.equal(await page.locator('[data-stream-player]').getAttribute('open'), '');
    assert.equal(await page.locator('[data-player-summary]').isVisible(), false);
    assert.equal(await page.locator('.stream-archives').isVisible(), true);
    assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), '');
    assert.equal(new URL(await page.locator('[data-chat-frame]').getAttribute('src')).searchParams.get('parent'), '127.0.0.1');
    await emit(page, 'online');
    assert.equal(await page.locator('[data-stream-offline]').isVisible(), false);
    assert.equal(await page.locator('[data-live-badge]').isVisible(), true);
    assert.equal(await page.locator('[data-stream-status]').textContent(), 'Сейчас в эфире');
    assert.equal(await page.locator('[data-stream-status]').getAttribute('role'), 'status');
    assert.equal(await page.locator('[data-stream-status]').getAttribute('aria-live'), 'polite');
    assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), '');
    await page.waitForFunction(() => document.querySelector('[data-chat-frame]').hasAttribute('src'));
    assert.equal(new URL(await page.locator('[data-chat-frame]').getAttribute('src')).searchParams.get('parent'), '127.0.0.1');
    assert.equal(await page.locator('#twitch-player iframe').getAttribute('title'), 'Twitch-плеер MASEAAAO');
    assert.deepEqual(await page.evaluate(() => window.__twitchPlayer.calls), [['setMuted', true], ['play']]);
    await emit(page, 'blocked'); assert.match(await page.locator('[data-stream-status]').textContent(), /Нажми ▶/);
    await emit(page, 'playing'); assert.equal(await page.locator('[data-stream-status]').textContent(), 'Сейчас в эфире');
    await emit(page, 'offline'); assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
    assert.deepEqual(traffic.errors, []);
  } finally { await context.close(); }
});

test('chat and offline player summaries work with keyboard and keep user preference through resize/state changes', async () => {
  const {page, context} = await newPage();
  try {
    await emit(page, 'ready', 'offline');
    await page.setViewportSize({width: 540, height: 1000});
    await page.waitForFunction(() => !document.querySelector('[data-player-summary]').hidden);
    const playerSummary = page.locator('[data-player-summary]');
    assert.equal(await playerSummary.isVisible(), true);
    assert.equal(await page.locator('[data-stream-player]').evaluate(e=>e.open), false);
    await playerSummary.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-stream-player]').getAttribute('open'), '');
    await page.setViewportSize({width: 1440, height: 1000});
    await page.waitForFunction(() => document.querySelector('[data-stream-chat]').open);
    const chatSummary = page.locator('[data-stream-chat] summary');
    assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), '');
    await chatSummary.focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), null);
    await chatSummary.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), '');
    await page.waitForFunction(() => document.querySelector('[data-chat-frame]').hasAttribute('src'));
    assert.equal(new URL(await page.locator('[data-chat-frame]').getAttribute('src')).searchParams.get('parent'), '127.0.0.1');
    await chatSummary.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), null);
    await emit(page, 'online'); assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), null);
    await page.setViewportSize({width: 540, height: 1000});
    await page.setViewportSize({width: 1440, height: 1000});
    assert.equal(await page.locator('[data-stream-chat]').getAttribute('open'), null);
  } finally { await context.close(); }
});

for (const mode of ['error', 'missing', 'constructor-error']) {
  test(`SDK ${mode} exposes accessible status, real fallback iframe and links without false LIVE`, async () => {
    const {page, context, traffic} = await newPage({sdkState: mode});
    try {
      await page.waitForFunction(() => document.querySelector('[data-stream-layout]').dataset.state === 'error');
      assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
      assert.equal(await page.locator('[data-player-fallback]').isVisible(), false);
      assert.equal(await page.locator('[data-stream-offline]').isVisible(), false);
      assert.match(await page.locator('[data-stream-status]').textContent(), /Не удалось определить статус/);
      const url = new URL(await page.locator('#twitch-player iframe').getAttribute('src'));
      assert.equal(url.searchParams.get('parent'), '127.0.0.1'); assert.equal(url.searchParams.get('channel'), 'maseaaao');
      assert.equal(url.searchParams.get('autoplay'), 'true');
      assert.equal(url.searchParams.get('muted'), 'true');
      assert.equal(await page.locator('[data-player-fallback]').textContent(), '');
      assert.equal(await page.locator('.tile--twitch').getAttribute('href'), 'https://www.twitch.tv/maseaaao');
      assert.equal(await page.locator('.tile--twitch').isVisible(), true);
      assert.deepEqual(traffic.errors, []);
    } finally { await context.close(); }
  });
}

async function layoutAudit(page) {
  return page.evaluate(() => {
    const visible = element => { if (!element) return false; const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && element.checkVisibility(); };
    const controls = [...document.querySelectorAll('a,button,summary')].filter(visible);
    return {
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      small: controls.filter(element => { const rect = element.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).map(element => ({text: element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height})),
      contentWidth: document.querySelector('.stream-content').getBoundingClientRect().width,
      mobileVisible: visible(document.querySelector('.stream-mobile')) && visible(document.querySelector('.tile--twitch')),
      player: visible(document.querySelector('#twitch-player iframe')) ? {width: document.querySelector('#twitch-player iframe').getBoundingClientRect().width, height: document.querySelector('#twitch-player iframe').getBoundingClientRect().height} : null,
    };
  });
}

for (const width of [320, 390, 540, 651, 767, 768, 900, 1000, 1001, 1300, 1440, 1920]) {
  test(`known offline/online/error UI fits ${width}px, 44px controls and player-width-aware fallback`, async () => {
    for (const state of ['offline', 'online', 'error']) {
      const {page, context} = await newPage({sdkState: state === 'error' ? 'error' : 'mock'});
      try {
        if (state === 'error') await page.waitForFunction(() => document.querySelector('[data-stream-layout]').dataset.state === 'error');
        else await emit(page, 'ready', state);
        await page.setViewportSize({width, height: 1000});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const ui = await layoutAudit(page);
        assert.ok(ui.scroll <= ui.viewport, `${state} overflow ${ui.scroll}>${ui.viewport}`);
        assert.deepEqual(ui.small, [], `${state} undersized controls`);
        if (ui.contentWidth < 402) assert.ok(ui.mobileVisible, `${state}: narrow content ${ui.contentWidth}px has no Twitch fallback`);
        if ((state !== 'offline' || width >= 768) && ui.contentWidth >= 402) { assert.ok(ui.player, `${state}: missing wide player`); assert.ok(ui.player.width >= 400, `Twitch frame too narrow ${ui.player.width}`); assert.ok(ui.player.height >= 300); }
      } finally { await context.close(); }
    }
  });
}


test('cold narrow columns expose Twitch external fallback even above the old 441px viewport cutoff', async () => {
  for (const width of [320,390]) {
    const {page, context, traffic} = await newPage({width});
    try {
      const ui = await layoutAudit(page);
      assert.ok(ui.mobileVisible, `No Twitch fallback in ${width}px viewport / ${ui.contentWidth}px content`);
      assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
      assert.equal(traffic.external.filter(url => url.includes('/js/embed/')).length, 0, 'SDK must not start below Twitch minimum width');
    } finally { await context.close(); }
  }
});

async function contrastAudit(page) {
  return page.evaluate(() => {
    const rgba = color => {
      const values = color.match(/[\d.]+/g)?.map(Number);
      return values ? [values[0], values[1], values[2], values[3] ?? 1] : [0,0,0,0];
    };
    const blend = (foreground, background) => foreground.slice(0,3).map((value, index) => value * foreground[3] + background[index] * (1-foreground[3]));
    const luminance = color => color.map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055)/1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126,.7152,.0722][index], 0);
    const background = element => {
      const chain = []; for (let current=element; current; current=current.parentElement) chain.unshift(current);
      return chain.reduce((color, current) => blend(rgba(getComputedStyle(current).backgroundColor), color), [255,255,255]);
    };
    const rows = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement;
      const text = node.textContent.trim();
      if (!text || !element || element.closest('script,style,[aria-hidden="true"],.sr-only') || !element.checkVisibility()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if (![...range.getClientRects()].some(rect => rect.width && rect.height)) continue;
      const style = getComputedStyle(element), bg = background(element), fg = blend(rgba(style.color), bg);
      const values = [luminance(fg), luminance(bg)].sort((a,b) => b-a), ratio = (values[0]+.05)/(values[1]+.05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.666 && parseFloat(style.fontWeight) >= 700);
      rows.push({text, ratio, minimum: large ? 3 : 4.5});
    }
    return rows;
  });
}

test('all visible landing text meets measured contrast in offline/online/error states', async () => {
  for (const state of ['offline','online','error']) {
    const {page, context} = await newPage({sdkState: state === 'error' ? 'error' : 'mock'});
    try {
      if (state === 'error') await page.waitForFunction(() => document.querySelector('[data-stream-layout]').dataset.state === 'error');
      else await emit(page, 'ready', state);
      for (const width of [320,390,540,1440]) {
        await page.setViewportSize({width,height:1000});
        const rows = await contrastAudit(page);
        assert.ok(rows.length > 10);
        assert.deepEqual(rows.filter(row => row.ratio < row.minimum), [], `${state}/${width}px text contrast`);
      }
    } finally { await context.close(); }
  }
});

test('every visible keyboard control has real focus ring, including unclipped chat summary', async () => {
  const {page, context} = await newPage();
  try {
    await emit(page, 'ready', 'offline');
    await page.keyboard.press('Tab');
    const controls = page.locator('a:visible,summary:visible');
    assert.ok(await controls.count() > 10);
    for (let index=0; index < await controls.count(); index++) {
      const control = controls.nth(index); await control.focus();
      const focus = await control.evaluate(element => {
        const style = getComputedStyle(element);
        return {visible: element.matches(':focus-visible'), width: style.outlineWidth, style: style.outlineStyle, offset: parseFloat(style.outlineOffset), chat: element.matches('.stream-chat summary')};
      });
      assert.ok(focus.visible, `no focus-visible for ${await control.textContent()}`);
      assert.equal(focus.width, '3px'); assert.equal(focus.style, 'solid');
      if (focus.chat) assert.ok(focus.offset <= -2, 'chat overflow:hidden clips an exterior summary outline');
    }
  } finally { await context.close(); }
});

test('upstream 12-second status timeout yields error without a fabricated LIVE badge', async () => {
  const {page, context} = await newPage({clock: true});
  try {
    await page.waitForFunction(() => window.__twitchPlayer);
    const before = await page.locator('#platform-links').boundingBox();
    assert.equal(await page.locator('[data-stream-player]').getAttribute('open'), '');
    await page.clock.fastForward(12001);
    const after = await page.locator('#platform-links').boundingBox();
    assert.equal(after.y, before.y, 'status failure must not move platform links');
    await page.evaluate(() => { window.__twitchPlayer.emit('ready'); window.__twitchPlayer.emit('online'); });
    assert.equal(await page.locator('[data-stream-layout]').getAttribute('data-state'), 'error');
    assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
    assert.equal(await page.locator('[data-player-fallback]').isVisible(), false);
  } finally { await context.close(); }
});

test('without JavaScript the real player, open-Twitch link and accessible chat summary remain', async () => {
  for (const width of [320,390,540,1440]) {
    const {page, context} = await newPage({width, javaScriptEnabled: false});
    try {
      assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
      const ui = await layoutAudit(page);
      assert.ok(ui.scroll <= ui.viewport);
      if (ui.contentWidth < 402) assert.ok(ui.mobileVisible); else assert.ok(ui.player);
      assert.equal(await page.locator('[data-stream-chat] summary').isVisible(), true);
      assert.match(await page.locator('#twitch-player iframe').getAttribute('src'), /channel=maseaaao/);
    } finally { await context.close(); }
  }
});

test('reduced motion, semantic labels, safe external links and avatar failure remain accessible', async () => {
  const {page, context} = await newPage();
  try {
    await emit(page, 'ready');
    const audit = await page.evaluate(() => ({
      duplicateIds: [...document.querySelectorAll('[id]')].map(element => element.id).filter((id,index,array) => array.indexOf(id) !== index),
      unsafe: [...document.querySelectorAll('a[target="_blank"]')].filter(element => !element.relList.contains('noopener') || !element.relList.contains('noreferrer')).map(element => element.href),
      anonymous: [...document.querySelectorAll('a,summary,iframe')].filter(element => !((element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent).trim())).map(element => element.outerHTML),
      duration: getComputedStyle(document.querySelector('.tile')).transitionDuration,
    }));
    assert.deepEqual(audit.duplicateIds, []); assert.deepEqual(audit.unsafe, []); assert.deepEqual(audit.anonymous, []); assert.equal(audit.duration, '0s');
    await page.locator('.avatar').evaluate(element => element.dispatchEvent(new Event('error')));
    assert.equal(await page.locator('.avatar').isVisible(), false);
    assert.equal(await page.locator('.avatar-fallback').isVisible(), true);
    assert.equal(await page.locator('.avatar-fallback').textContent(), 'm');
  } finally { await context.close(); }
});

if (process.env.LANDING_AUDIT_OUT) {
  test('capture real Chromium screenshots, measured layouts/contrast, fonts and isolated Twitch evidence', async () => {
    const directory = path.resolve(process.env.LANDING_AUDIT_OUT);
    await fs.mkdir(directory, {recursive: false}); // Never overwrite a previous evidence run.
    const evidence = {upstreamRef, chromeVersion: browser.version(), rows: [], fontRequests: [], errors: [], externalNetwork: 'all external requests intercepted; SDK/iframes are isolated test responses'};
    for (const state of ['offline','online','error']) {
      const {page, context, traffic} = await newPage({sdkState: state === 'error' ? 'error' : 'mock'});
      try {
        if (state === 'error') await page.waitForFunction(() => document.querySelector('[data-stream-layout]').dataset.state === 'error');
        else await emit(page, 'ready', state);
        for (const width of [320,390,540,768,900,1024,1300,1440,1920]) {
          await page.setViewportSize({width,height:1000});
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const screenshot = `${state}-${width}.png`;
          await page.screenshot({path:path.join(directory,screenshot),fullPage:true});
          evidence.rows.push({state,width,screenshot,layout:await layoutAudit(page),contrast:await contrastAudit(page)});
        }
        evidence.fontRequests.push(...traffic.fonts); evidence.errors.push(...traffic.errors);
      } finally { await context.close(); }
    }
    const narrow = await newPage({width:390});
    try {
      await narrow.page.screenshot({path:path.join(directory,'cold-mobile-390.png'),fullPage:true});
      evidence.rows.push({state:'cold-mobile-loading',width:390,screenshot:'cold-mobile-390.png',layout:await layoutAudit(narrow.page)});
    } finally { await narrow.context.close(); }
    const focus = await newPage();
    try {
      await emit(focus.page, 'ready','offline');
      await focus.page.keyboard.press('Tab');
      await focus.page.locator('[data-stream-chat] summary').focus();
      await focus.page.screenshot({path:path.join(directory,'focus-chat-desktop.png'),fullPage:true});
      await focus.page.keyboard.press('Enter');
      await focus.page.locator('[data-stream-chat] summary').blur();
      await focus.page.screenshot({path:path.join(directory,'offline-desktop-chat-closed.png'),fullPage:true});
    } finally { await focus.context.close(); }
    await fs.writeFile(path.join(directory,'browser-evidence.json'),JSON.stringify(evidence,null,2));
    assert.deepEqual(evidence.errors, []);
    console.log(`SCREENSHOTS ${directory}`);
  });
}


test("fractional container widths below 402px retain the Twitch fallback", async () => {
  const {page, context} = await newPage();
  try {
    await emit(page, "ready", "online");
    await page.locator(".stream-content").evaluate(element => element.style.width = "401.5px");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const ui = await layoutAudit(page);
    assert.equal(ui.contentWidth, 401.5);
    assert.ok(ui.mobileVisible, "fractional sub-402px content has no external Twitch fallback");
  } finally { await context.close(); }
});

for (const colorScheme of ['light', 'dark']) {
  test(`system ${colorScheme}: theme works without JavaScript and at narrow widths`, async () => {
    const {page, context} = await newPage({colorScheme, javaScriptEnabled: false, width: 320});
    try {
      assert.equal(await page.locator('[data-theme-control]').isVisible(), false);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), colorScheme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.emulateMedia({colorScheme: colorScheme === 'dark' ? 'light' : 'dark'});
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), colorScheme === 'dark' ? 'light' : 'dark');
    } finally { await context.close(); }
  });
  test(`system ${colorScheme}: manual theme persists, overrides OS, and auto resumes following OS`, async () => {
    const {page, context} = await newPage({colorScheme, width: 390});
    try {
      const opposite = colorScheme === 'dark' ? 'light' : 'dark';
      await chooseTheme(page, opposite);
      await page.reload();
      assert.equal(await page.locator('[data-theme-value][aria-pressed="true"]').getAttribute('data-theme-value'), opposite);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), opposite);
      await page.goto(origin + '/dist/docs.html');
      assert.equal(await page.locator('[data-theme-value][aria-pressed="true"]').getAttribute('data-theme-value'), opposite);
      await chooseTheme(page, 'auto');
      assert.equal(await page.evaluate(() => localStorage.getItem('maseaaao.theme.v1')), null);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), colorScheme);
      await page.emulateMedia({colorScheme: opposite});
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), opposite);
    } finally { await context.close(); }
  });
}
test('dark landing text and hover states retain high contrast at mobile and desktop sizes', async () => {
  for (const width of [320,390,540,1440]) {
    const {page, context} = await newPage({colorScheme: 'dark'});
    try {
      await emit(page, 'ready', 'offline');
      await page.setViewportSize({width, height: 1000});
      const rows = await contrastAudit(page);
      assert.deepEqual(rows.filter(row => row.ratio < row.minimum), []);
      await page.locator('.tile--donationalerts').hover();
      assert.deepEqual((await contrastAudit(page)).filter(row => row.ratio < row.minimum), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await context.close(); }
  }
});
test('blocked storage keeps the theme control functional', async () => {
  const {page, context} = await newPage();
  try {
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', {get() { throw new Error('Storage blocked'); }}));
    await page.reload();
    await chooseTheme(page, 'dark');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
    await chooseTheme(page, 'auto');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
  } finally { await context.close(); }
});

test('single theme button opens an accessible dropdown and restores focus after selection or Escape', async () => {
  const {page, context} = await newPage({colorScheme: 'dark', width: 320});
  try {
    const trigger = page.locator('.theme-trigger');
    const menu = page.locator('.theme-menu');
    assert.equal(await menu.isVisible(), false);
    for (const value of ['light', 'dark', 'auto']) {
      await trigger.focus();
      await page.keyboard.press('Space');
      assert.equal(await menu.isVisible(), true);
      const button = page.locator(`[data-theme-value="${value}"]`);
      await button.focus();
      await page.keyboard.press('Space');
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-theme-value][aria-pressed="true"]').count(), 1);
      assert.equal(await menu.isVisible(), false);
      assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
      assert.equal(await trigger.evaluate(element => getComputedStyle(element).outlineWidth), '3px');
      assert.ok(await trigger.getAttribute('aria-label'));
    }
    await trigger.click();
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
    assert.deepEqual((await contrastAudit(page)).filter(row => row.ratio < row.minimum), []);
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
    await trigger.click();
    await page.locator('#profile-name').click();
    assert.equal(await menu.isVisible(), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
  } finally { await context.close(); }
});

test('desktop keeps the same video and chat mounted through online and offline transitions', async () => {
  const {page, context} = await newPage();
  try {
    await emit(page, 'ready', 'online');
    await page.evaluate(() => { window.__retainedVideo = document.querySelector('#twitch-player iframe'); window.__retainedChat = document.querySelector('[data-chat-frame]'); });
    for (const state of ['offline', 'online', 'offline']) {
      await emit(page, state);
      assert.equal(await page.locator('[data-stream-player]').evaluate(e=>e.open), true);
      assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open), true);
      assert.equal(await page.evaluate(() => window.__retainedVideo === document.querySelector('#twitch-player iframe') && window.__retainedChat === document.querySelector('[data-chat-frame]')), true);
    }
  } finally { await context.close(); }
});

test('desktop media defaults update even when the player column keeps the same width', async () => {
  const {page, context} = await newPage({cssOverride: css + '\n.stream-content { width:450px }'});
  try {
    await emit(page, 'ready', 'offline');
    await page.setViewportSize({width:767, height:1000});
    await page.waitForFunction(() => !document.querySelector('[data-stream-player]').open);
    await page.setViewportSize({width:768, height:1000});
    await page.waitForFunction(() => document.querySelector('[data-stream-player]').open && document.querySelector('[data-stream-chat]').open);
    assert.equal(await page.locator('[data-stream-offline]').isVisible(), false);
  } finally { await context.close(); }
});
