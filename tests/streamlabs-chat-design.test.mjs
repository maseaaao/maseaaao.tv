import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

const read = (name) =>
  readFileSync(
    new URL('../apps/obs-widgets/dist/streamlabs-chat/' + name, import.meta.url),
    'utf8',
  );

test('chat keeps the brand hierarchy, wrapping and transparent canvas over a legacy provider theme', async () => {
  const browser = await launchBrowser();
  try {
    for (const width of [320, 390, 540, 1100]) {
      const page = await browser.newPage({ colorScheme: 'dark' });
      await page.setViewportSize({ width, height: 1800 });
      await page.setContent(`<!doctype html><html lang="ru"><head><style>
        #log .meta { max-width:42%; border-right:1px solid red; justify-content:flex-end; }
        #log .meta::before { content:'✦'; }
        #log > div { display:flex; box-shadow:0 0 20px purple; }
        </style><style>${read('chat-box.css')
          .replaceAll('{font_size}', '36px')
          .replaceAll(
            '{message_hide_delay}',
            '600s',
          )}</style></head><body>${read('chat-box.html')}</body></html>`);
      await page.addScriptTag({ content: read('chat-box.js') });
      await page.evaluate(() => {
        const template = document.getElementById('chatlist_item').textContent;
        for (const [from, message] of [
          ['maseaaao', 'Привет! Проверяем оформление.'],
          ['ДлинныйНикЗрителя'.repeat(8), 'Длинноесловобезпробелов'.repeat(12)],
          ['viewer', '@maseaaao привет 👋'],
        ]) {
          const holder = document.createElement('div');
          holder.innerHTML = template
            .replaceAll('{from}', from)
            .replaceAll('{messageId}', from)
            .replaceAll('{message}', message);
          const item = holder.firstElementChild;
          // Account-selected nickname colors must not defeat brand contrast.
          item.querySelector('.meta').style.color = '#ffffff';
          document.getElementById('log').append(item);
        }
      });
      await page.locator('#log > .host').waitFor();
      const result = await page.evaluate(() => {
        const host = document.querySelector('.host .meta');
        const regular = document.querySelector('#log > div:nth-child(2) .meta');
        const message = document.querySelector('#log > div:nth-child(2) .message');
        return {
          hostColor: getComputedStyle(host).color,
          hostBackground: getComputedStyle(host).backgroundColor,
          authorColor: getComputedStyle(regular).color,
          textColor: getComputedStyle(message).color,
          authorAboveText:
            regular.getBoundingClientRect().bottom <= message.getBoundingClientRect().top,
          decoration: getComputedStyle(regular, '::before').content,
          noShadow: getComputedStyle(regular.parentElement).boxShadow,
          overflow: [...document.querySelectorAll('#log > div, .message')].some(
            (element) => element.scrollWidth > element.clientWidth + 1,
          ),
          canvas: getComputedStyle(document.body).backgroundColor,
          delay: getComputedStyle(document.querySelector('#log > div')).animationDelay,
        };
      });
      assert.equal(result.hostColor, 'rgb(244, 243, 236)');
      assert.equal(result.hostBackground, 'rgb(22, 22, 217)');
      assert.equal(result.authorColor, 'rgb(22, 22, 217)');
      assert.equal(result.textColor, 'rgb(32, 32, 30)');
      assert.equal(result.authorAboveText, true);
      assert.equal(result.decoration, 'none');
      assert.equal(result.noShadow, 'none');
      assert.equal(result.overflow, false, `No clipped message at ${width}px`);
      assert.equal(result.canvas, 'rgba(0, 0, 0, 0)');
      assert.equal(result.delay, '0s, 0s, 600s');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(
        await page
          .locator('#log > div')
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
        'appearStill, none, fadeAway',
      );
      const reduced = await page
        .locator('#log > div')
        .first()
        .evaluate((el) => {
          const fade = el
            .getAnimations()
            .find((animation) => animation.animationName === 'fadeAway');
          const delay = fade.effect.getTiming().delay;
          fade.pause();
          fade.currentTime = delay - 1;
          const before = getComputedStyle(el).opacity;
          fade.currentTime = delay + 500;
          return { delay, before, after: getComputedStyle(el).opacity };
        });
      assert.equal(reduced.delay, 600000, 'Reduced motion preserves the provider hide delay');
      assert.equal(reduced.before, '1');
      assert.equal(reduced.after, '0');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
