import postcss from 'postcss';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';
const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('standalone output statistics embeds the shared font with data font CSP', () => {
  const html = read('apps/obs-widgets/dist/output-stats/index.html');
  assert.match(html, /font-src data:/);
  assert.match(html, /@font-face\s*\{\s*font-family:\s*Unbounded/);
});
test('chat and alert skins use canonical warm-light tokens without changing event timings', () => {
  for (const file of ['chat-box.css', 'donationalerts-alerts.css']) {
    const css = read('apps/obs-widgets/dist/streamlabs-chat/' + file);
    const declarations = new Map();
    postcss
      .parse(css.replaceAll('{font_size}', '32px').replaceAll('{message_hide_delay}', '600s'))
      .walkDecls((decl) => declarations.set(decl.prop, decl.value));
    for (const [name, value] of Object.entries({
      '--cm-surface': 'var(--surface)',
      '--cm-raised': 'var(--hud-surface)',
      '--cm-text': 'var(--text)',
      '--cm-accent': 'var(--accent)',
    }))
      assert.equal(declarations.get(name), value, `${file}: ${name}`);
    assert.doesNotMatch(css, /#C182F3|rgba\(10,13,18|#68517E/i);
  }
  const chat = read('apps/obs-widgets/dist/streamlabs-chat/chat-box.css');
  assert.match(chat, /font-size:\s*\{font_size\}/);
  assert.match(chat, /fadeAway 0?\.5s ease \{message_hide_delay\} forwards/);
  assert.doesNotMatch(
    read('apps/obs-widgets/dist/streamlabs-chat/donationalerts-alerts.css'),
    /animation\s*:|opacity\s*:|display\s*:\s*(?:block|flex)/,
  );
});
test('scene CSS and its generator include the system Arial fallback', () => {
  for (const file of ['artwork/scenes/obs-scene.css']) {
    const css = read(file);
    assert.match(css, /Unbounded,\s*Arial,\s*sans-serif/);
    assert.doesNotMatch(css, /Unbounded,sans-serif/);
  }
});

test('real Chromium provider-shaped text stress fixtures load fonts and retain lifecycle styles', async () => {
  const browser = await launchBrowser();
  try {
    // Streamlabs uses the actual repository item template. DonationAlerts retains
    // its table-row/table-cell wrapper and scoped stats-list; no provider script runs.
    const badge =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#1616d9"/></svg>',
      );
    const transparent = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    const context = await browser.newContext({
      viewport: { width: 1100, height: 800 },
      colorScheme: 'dark',
    });
    const requests = [];
    await context.route('**/*', (route) => {
      requests.push(route.request().url());
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head></head><body></body></html>',
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('https://widgets-fixture.invalid/');
    const chat = read('apps/obs-widgets/dist/streamlabs-chat/chat-box.css')
      .replaceAll('{font_size}', '32px')
      .replaceAll('{message_hide_delay}', '600s');
    await page.addStyleTag({ content: chat });
    await page
      .locator('body')
      .evaluate(
        (body, html) => (body.innerHTML = html),
        read('apps/obs-widgets/dist/streamlabs-chat/chat-box.html'),
      );
    await page.addScriptTag({ content: read('apps/obs-widgets/dist/streamlabs-chat/chat-box.js') });
    await page.evaluate(
      ({ badge, transparent }) => {
        const template = document.getElementById('chatlist_item').textContent;
        const data = [
          ['maseaaao', '#1616d9', 'Проверка кириллицы, English, 12345.'],
          [
            'ОченьДлинныйНикБезПробелов'.repeat(5),
            '#8a2940',
            'maseaaao ' + 'Сверхдлинноесловобезпробелов'.repeat(8),
          ],
        ];
        for (const [from, color, message] of data) {
          const holder = document.createElement('div');
          holder.innerHTML = template
            .replaceAll('{from}', from)
            .replaceAll('{messageId}', from)
            .replaceAll('{color}', color)
            .replaceAll('{message}', message);
          const item = holder.firstElementChild;
          item.querySelector('.badges').innerHTML =
            `<img class="badge" src="${badge}"><img class="badge" src="${badge}">`;
          item
            .querySelector('.message')
            .insertAdjacentHTML(
              'beforeend',
              ` <span class="emote" style="background-image:url('${badge}')"><img src="${transparent}" alt="Kappa"></span>`,
            );
          document.getElementById('log').append(item);
        }
      },
      { badge, transparent },
    );
    await page.evaluate(async () => {
      await document.fonts.load('600 24px Unbounded', 'Проверка English');
      await document.fonts.ready;
    });
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#log > .host').count(), 1);
    assert.equal(await page.locator('#log > .mention').count(), 1);
    const metrics = await page.evaluate(() => ({
      font: document.fonts.check('600 24px Unbounded', 'Кириллица'),
      bg: getComputedStyle(document.querySelector('#log>div.mention')).backgroundColor,
      overflow: [...document.querySelectorAll('#log .message')].some(
        (x) => x.scrollWidth > x.clientWidth + 1,
      ),
      name: getComputedStyle(document.querySelector('.name')).textOverflow,
      emote: getComputedStyle(document.querySelector('.emote')).backgroundSize,
      badge: document.querySelector('.badge').getBoundingClientRect().height,
      delay: getComputedStyle(document.querySelector('#log>div')).animationDelay,
    }));
    assert.equal(metrics.font, true);
    assert.equal(metrics.bg, 'rgb(244, 243, 236)');
    assert.equal(metrics.overflow, false);
    assert.equal(metrics.name, 'ellipsis');
    assert.equal(metrics.emote, 'contain');
    assert.ok(metrics.badge > 0);
    assert.equal(metrics.delay, '0s, 600s');
    if (process.env.WIDGET_SHOTS)
      await page.screenshot({ path: resolve(process.env.WIDGET_SHOTS, 'chat-stress.png') });
    await page.close();
    for (const kind of ['alerts', 'donors']) {
      const p = await context.newPage();
      await p.setViewportSize({ width: 1100, height: kind === 'alerts' ? 367 : 148 });
      await p.goto('https://widgets-fixture.invalid/' + kind);
      const file =
        kind === 'alerts'
          ? 'apps/obs-widgets/dist/streamlabs-chat/donationalerts-alerts.css'
          : 'apps/obs-widgets/dist/donors/donationalerts-stream-stats.css';
      await p.addStyleTag({ content: read(file) });
      const long = 'ОченьДлинноеИмяБезПробелов'.repeat(6);
      const html =
        kind === 'alerts'
          ? `<div class="alert-container" style="opacity:.75;transition-duration:1.7s"><div id="donation-alert" style="display:table;width:100%;table-layout:fixed"><div style="display:table-row"><div style="display:table-cell"><div class="image-container"><div class="image"></div></div><div class="text"><div class="title"><span>${long}</span> — 12 345 ₽</div><div class="message"><span>Спасибо за стрим! English / Кириллица. ${'Словобезпробелов'.repeat(12)}</span></div></div></div></div></div></div>`
          : `<div class="widget-stream-stats"><div class="stats-list"><div class="stats-list-item fade-in-out-enter-active"><div class="stats-item-main-row">${long} — 123 456 ₽</div><div class="stats-item-additional-row">За месяц · ${long}</div></div></div></div>`;
      await p.locator('body').evaluate((b, h) => (b.innerHTML = h), html);
      await p.evaluate(async () => {
        await document.fonts.load('600 32px Unbounded', 'Проверка English');
        await document.fonts.ready;
      });
      const measure = await p.evaluate((kind) => {
        const row = document.querySelector(kind === 'alerts' ? '.title' : '.stats-item-main-row');
        const text = document.querySelector(
          kind === 'alerts' ? '.message' : '.stats-item-additional-row',
        );
        const card = document.querySelector(
          kind === 'alerts' ? '#donation-alert' : '.stats-list-item',
        );
        const rect = card.getBoundingClientRect();
        return {
          font: getComputedStyle(row).fontFamily,
          text: getComputedStyle(text).color,
          x: rect.right,
          height: rect.height,
          opacity:
            kind === 'alerts'
              ? getComputedStyle(document.querySelector('.alert-container')).opacity
              : null,
          duration:
            kind === 'alerts'
              ? getComputedStyle(document.querySelector('.alert-container')).transitionDuration
              : null,
          overflow: row.scrollWidth > row.clientWidth + 1,
        };
      }, kind);
      assert.match(measure.font, /Unbounded/);
      assert.equal(measure.overflow, false);
      assert.ok(measure.x <= 1101, JSON.stringify(measure));
      assert.ok(measure.height <= (kind === 'alerts' ? 367 : 148), JSON.stringify(measure));
      if (kind === 'alerts') {
        assert.equal(measure.opacity, '0.75');
        assert.equal(measure.duration, '1.7s');
        assert.equal(measure.text, 'rgb(32, 32, 30)');
      }
      if (process.env.WIDGET_SHOTS)
        await p.screenshot({ path: resolve(process.env.WIDGET_SHOTS, kind + '-stress.png') });
      await p.close();
    }
    assert.deepEqual(errors, []);
    assert.equal(
      requests.filter((url) => !url.startsWith('https://widgets-fixture.invalid/')).length,
      0,
    );
    await context.close();
  } finally {
    await browser.close();
  }
});

test('output statistics labels and rendered statuses are Russian, without a real connection', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.fixtureCsp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.fixtureCsp.push(e.violatedDirective),
      );
    });
    await page.addInitScript(() => {
      window.WebSocket = class extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 1;
        constructor() {
          super();
          queueMicrotask(() => {
            this.dispatchEvent(new Event('open'));
            this.reply({ op: 0, d: { rpcVersion: 1 } });
          });
        }
        reply(message) {
          queueMicrotask(() =>
            this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })),
          );
        }
        send(raw) {
          const message = JSON.parse(raw);
          if (message.op === 1) this.reply({ op: 2, d: { negotiatedRpcVersion: 1 } });
          if (message.op === 6)
            this.reply({
              op: 7,
              d: {
                requestId: message.d.requestId,
                requestStatus: { result: true },
                responseData:
                  message.d.requestType === 'GetOutputList'
                    ? { outputs: [{ outputName: 'Тестовый выход', outputActive: true }] }
                    : {
                        outputBytes: Math.round(Date.now() * 750),
                        outputTotalFrames: Math.round(Date.now() * 0.06),
                        outputSkippedFrames: 0,
                      },
              },
            });
        }
        close() {
          this.readyState = 3;
        }
      };
    });
    await page.goto(
      pathToFileURL(resolve(root, 'apps/obs-widgets/dist/output-stats/index.html')).href,
    );
    assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
    assert.equal(await page.locator('#connect-button').innerText(), 'ПОДКЛЮЧИТЬ');
    assert.equal(await page.locator('#status-text').innerText(), 'Отключено');
    assert.match(await page.locator('.row-header').innerText(), /Выход/);
    await page.getByLabel('Пароль OBS WebSocket', { exact: true }).fill('fixture-only-password');
    await page.getByLabel('Запомнить', { exact: true }).check();
    await page.locator('#connect-button').click();
    await page.waitForFunction(() =>
      document.querySelector('#display').textContent.includes('НОРМА'),
    );
    assert.match(await page.locator('#display').innerText(), /НОРМА/);
    assert.match(await page.locator('#display').innerText(), /ЭФИР/);
    await page.waitForFunction(
      () => localStorage.getItem('easy-output-stats.credentials.v1') !== null,
    );
    const saved = await page.evaluate(() =>
      localStorage.getItem('easy-output-stats.credentials.v1'),
    );
    assert(
      saved && !saved.includes('fixture-only-password'),
      'Remember stores an encrypted record, never the raw password',
    );
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('#display').textContent.includes('НОРМА'),
    );
    assert(
      await page.getByLabel('Запомнить', { exact: true }).isChecked(),
      'Saved credentials restore on reopening the built file',
    );
    assert.equal(await page.getByLabel('Пароль OBS WebSocket', { exact: true }).inputValue(), '');
    await page.locator('#forget-button').click();
    await page.waitForFunction(
      () => localStorage.getItem('easy-output-stats.credentials.v1') === null,
    );
    assert.equal(await page.getByLabel('Запомнить', { exact: true }).isChecked(), false);
    await page.evaluate(async () => {
      await document.fonts.load('400 12px Unbounded', 'История English');
      await document.fonts.ready;
    });
    assert.equal(
      await page.evaluate(() =>
        [...document.fonts].some((f) => f.family === 'Unbounded' && f.status === 'loaded'),
      ),
      true,
    );
    assert.deepEqual(await page.evaluate(() => window.fixtureCsp), []);
    for (const width of [320, 390, 540, 1000]) {
      await page.setViewportSize({ width, height: 700 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `output width ${width}`,
      );
    }
    if (process.env.WIDGET_SHOTS) {
      await page.screenshot({
        path: resolve(process.env.WIDGET_SHOTS, 'stats-1000.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 700 });
      await page.screenshot({
        path: resolve(process.env.WIDGET_SHOTS, 'stats-390.png'),
        fullPage: true,
      });
    }
    const row = page
      .getByRole('table', { name: 'Выходы OBS', exact: true })
      .getByRole('row')
      .nth(1);
    assert.equal(
      await row.getByRole('cell').count(),
      8,
      'Every metric remains available on narrow screens',
    );
    await page.setViewportSize({ width: 320, height: 700 });
    const scroll = page.getByRole('region', {
      name: 'Таблица выходов: прокрутка по горизонтали',
      exact: true,
    });
    await scroll.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.stats-scroll').scrollLeft > 0);
    assert(await scroll.evaluate((element) => element === document.activeElement));
    await page.locator('#connect-button').click();
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll('body, body *')];
      const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
      elements.forEach((element, index) => {
        element.style.fontSize = `${sizes[index] * 2}px`;
      });
    });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Stats text at 200% fits the viewport',
    );
    assert(
      await page
        .locator('.grid-layout > *')
        .evaluateAll((cells) => cells.every((cell) => cell.scrollWidth <= cell.clientWidth + 1)),
      'Each enlarged header and value stays within its own column',
    );
    for (const id of ['connect-button', 'forget-button', 'target-url', 'target-password'])
      assert((await page.locator(`#${id}`).boundingBox()).height >= 44, `${id}: touch target`);
    assert.deepEqual(
      await page.evaluate(() => window.fixtureCsp),
      [],
      'CSP remains strict through keyboard and enlarged text checks',
    );
    if (process.env.WIDGET_SHOTS)
      await page.screenshot({
        path: resolve(process.env.WIDGET_SHOTS, 'stats-320-text-200.png'),
        fullPage: true,
      });
    await page.locator('#target-url').fill('https://invalid.example');
    await page.locator('#connect-button').click();
    assert.match(await page.locator('#status-text').innerText(), /Разрешены только/);
  } finally {
    await browser.close();
  }
});
