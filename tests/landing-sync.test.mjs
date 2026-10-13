import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

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
  browser = await chromium.launch({executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true});
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

async function newPage({width = 1440, sdkState = 'mock', javaScriptEnabled = true, htmlOverride, cssOverride, clock = false} = {}) {
  const context = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce', javaScriptEnabled});
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
test('stream.js differs from upstream only by the two user-approved nonmobile chat defaults', async () => {
  const original = execFileSync('git', ['cat-file', '--filters', `${upstreamRef}:dist/assets/stream.js`], {cwd: root}).toString('utf8');
  const expected = original.replace('window.matchMedia("(min-width:1000px)")', 'window.matchMedia("(min-width:651px)")')
    .replace('chatPreference ?? (status === "online" && desktop.matches)', 'chatPreference ?? desktop.matches');
  assert.notEqual(expected, original);
  assert.equal((await fs.readFile(path.join(root, 'dist/assets/stream.js'))).equals(Buffer.from(expected)), true, 'unapproved upstream script change');
});

test('Cyber-Monolith composition, angular avatars and Geologica survive upstream merge', async () => {
  const {page, context} = await newPage();
  try {
    const ui = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
      loaded: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family),
      tileRadius: getComputedStyle(document.querySelector('.tile')).borderRadius,
      avatarRadius: getComputedStyle(document.querySelector('.avatar')).borderRadius,
      shellWidth: document.querySelector('.shell').getBoundingClientRect().width,
      identityBorder: getComputedStyle(document.querySelector('.identity')).borderTopWidth,
      corner: getComputedStyle(document.querySelector('.identity'), '::before').borderTopWidth,
    }));
    assert.equal(ui.bg, 'rgb(5, 6, 8)');
    assert.match(ui.font, /Geologica/); assert.ok(ui.loaded.includes('Geologica')); assert.ok(ui.loaded.includes('Unbounded'));
    assert.ok(parseFloat(ui.tileRadius) <= 2, `HUD tile radius ${ui.tileRadius}`);
    assert.equal(ui.avatarRadius, '0px', 'HUD avatar must remain angular');
    assert.ok(ui.shellWidth > 1000, `HUD desktop composition collapsed: ${ui.shellWidth}`);
    assert.equal(ui.identityBorder, '1px'); assert.equal(ui.corner, '2px');
  } finally { await context.close(); }
});

// Guard sensitivity: removing new hooks or restoring round upstream visuals
// really fails the same assertions, rather than silently rebasing regressions.
test('upstream feature contract rejects the pre-sync local landing', () => {
  const old = execFileSync('git', ['show', 'ca39891154536909ee85f30343dbaa075fcd2e02:dist/index.html'], {cwd: root, encoding: 'utf8'});
  assert.throws(() => checkFeatures(old), /Missing upstream feature/);
});


test('local approved Twitch and donation supporting copy survives synchronization', () => {
  assert.ok(html.includes('Смотреть стримы'), 'lost local Twitch supporting copy');
  assert.ok(html.includes('Во время трансляции'), 'lost local DonationAlerts supporting copy');
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

test('all upstream destinations, copy, discovery metadata and scripts are retained; old real links/copy also survive', async () => {
  const current = await newPage({javaScriptEnabled: false});
  const reference = await newPage({javaScriptEnabled: false, htmlOverride: upstream('dist/index.html').toString('utf8')});
  const old = await newPage({javaScriptEnabled: false, htmlOverride: execFileSync('git', ['show', 'ca39891154536909ee85f30343dbaa075fcd2e02:dist/index.html'], {cwd: root, encoding: 'utf8'})});
  try {
    const actual = await current.page.evaluate(snapshotDOM);
    const expected = await reference.page.evaluate(snapshotDOM);
    const local = await old.page.evaluate(snapshotDOM);
    // User explicitly removed the mobile watch CTA and the player fallback link only.
    assert.deepEqual(actual.anchors, expected.anchors.filter((_, index) => index !== 3 && index !== 4));
    assert.deepEqual(actual.head, expected.head);
    assert.equal(actual.title, expected.title);
    assert.deepEqual(actual.scripts, expected.scripts);
    let text = actual.text;
    for (const copy of ['Смотретьстримы', 'Вовремятрансляции']) { assert.ok(text.includes(copy)); text = text.replace(copy, ''); }
    const requestedCopy = expected.text.replace('СмотретьстримнаTwitch↗','').replace('Еслиплеернезагрузился,откройTwitch↗.','');
    assert.equal(text, requestedCopy, 'upstream copy remains exact except local additions and explicitly removed duplicate watch copy');
    for (const destination of local.anchors) assert.ok(actual.anchors.includes(destination), `lost local destination ${destination}`);
    const copies = await old.page.locator('h1,h2,.identity__description,.tile__title,.tile__meta,.collab__label,.collab__mail').allTextContents();
    for (const copy of copies) assert.ok(actual.text.includes(copy.replace(/\s+/g, '')), `lost local copy ${copy}`);
  } finally { await Promise.all([current.context.close(), reference.context.close(), old.context.close()]); }
});

test('font requests are local successful Geologica/Unbounded, not Inter or a remote CDN', async () => {
  const {page, context, traffic} = await newPage();
  try {
    const requests = traffic.fonts;
    assert.ok(requests.some(request => /\/Geologica\.[a-f0-9]{16}\.woff2$/.test(request.url)));
    assert.ok(requests.some(request => /\/Unbounded\.[a-f0-9]{16}\.woff2$/.test(request.url)));
    for (const request of requests) { assert.equal(request.status, 200); assert.ok(request.url.startsWith(origin)); assert.doesNotMatch(request.url, /Inter/); }
    assert.deepEqual(traffic.errors, []);
  } finally { await context.close(); }
});

test('READY alone never invents LIVE; offline/live/playback-blocked transitions execute upstream script', async () => {
  const {page, context, traffic} = await newPage();
  try {
    await emit(page, 'ready');
    assert.equal(await page.locator('[data-stream-layout]').getAttribute('data-state'), 'loading');
    assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
    await emit(page, 'offline');
    assert.equal(await page.locator('[data-stream-layout]').getAttribute('data-state'), 'offline');
    assert.equal(await page.locator('[data-stream-offline]').isVisible(), true);
    assert.equal(await page.locator('[data-live-badge]').isVisible(), false);
    assert.equal(await page.locator('[data-stream-player]').getAttribute('open'), null);
    assert.equal(await page.locator('[data-player-summary]').isVisible(), true);
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
    const playerSummary = page.locator('[data-player-summary]');
    await playerSummary.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-stream-player]').getAttribute('open'), '');
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

for (const width of [320, 390, 540, 651, 768, 900, 1000, 1300, 1440, 1920]) {
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
        if (state !== 'offline' && ui.contentWidth >= 402) { assert.ok(ui.player, `${state}: missing wide player`); assert.ok(ui.player.width >= 400, `Twitch frame too narrow ${ui.player.width}`); assert.ok(ui.player.height >= 300); }
      } finally { await context.close(); }
    }
  });
}


test('cold narrow columns expose Twitch external fallback even above the old 441px viewport cutoff', async () => {
  for (const width of [320,390,651,720]) {
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
      if (!text || !element || element.closest('script,style,[aria-hidden="true"]') || !element.checkVisibility()) continue;
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
      assert.equal(focus.width, '2px'); assert.equal(focus.style, 'solid');
      if (focus.chat) assert.ok(focus.offset <= -2, 'chat overflow:hidden clips an exterior summary outline');
    }
  } finally { await context.close(); }
});

test('upstream 12-second status timeout yields error without a fabricated LIVE badge', async () => {
  const {page, context} = await newPage({clock: true});
  try {
    await page.waitForFunction(() => window.__twitchPlayer);
    await page.clock.fastForward(12001);
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
