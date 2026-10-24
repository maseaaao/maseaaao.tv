import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

const css = readFileSync(
  resolve(import.meta.dirname, '../apps/obs-widgets/dist/donors/donationalerts-stream-stats.css'),
  'utf8',
);
// Provider's scoped layout and v-show lifecycle, without its network or donor data.
const native = `html,body{height:100%}.widget-stream-stats[data-v-318f5eb8]{display:flex;flex-direction:column;width:100%;height:100%}
.widget-stream-stats.v-align-middle[data-v-318f5eb8]{justify-content:center}
.widget-stream-stats .stats-slider[data-v-318f5eb8]{position:relative}
.widget-stream-stats .stats-slider-wrapper[data-v-318f5eb8]{display:flex;align-items:center}
.widget-stream-stats .stats-slider .stats-list-item[data-v-318f5eb8]{width:100%}
.fade-in-out-enter[data-v-318f5eb8],.fade-in-out-leave-to[data-v-318f5eb8]{opacity:0}
.fade-in-out-leave-to[data-v-318f5eb8]{position:absolute}
.fade-in-out-enter-active[data-v-318f5eb8],.fade-in-out-leave-active[data-v-318f5eb8]{transition:opacity .3s}`;
const card = (id, name, subtitle, hidden = false) =>
  `<div id="${id}" class="stats-list-item" data-v-318f5eb8 ${hidden ? 'style="display:none"' : ''}><div class="stats-item-main-row" style="line-height:1;text-align:center">${name}</div>${subtitle ? '<div class="stats-item-additional-row">Топ за месяц · Спасибо за поддержку</div>' : ''}</div>`;

test('donor panel stays fixed while text rolls, including v-show, long names and reduced motion', async () => {
  const browser = await launchBrowser();
  try {
    for (const mode of ['stats-slider', 'stats-list']) {
      for (const [oldName, newName, subtitle, reduced, forceMotion] of [
        ['Аноним — 1 USD', 'Следующий — 100 RUB', false, false],
        ['ОченьДлинноеИмяБезПробелов'.repeat(6), 'Короткий — 1 USD', false, false],
        ['Короткий — 1 USD', 'ОченьДлинноеИмяБезПробелов'.repeat(6), true, false],
        ['Первый — 1 USD', 'Второй — 2 USD', false, true],
        ['Первый — 1 USD', 'Второй — 2 USD', false, true, true],
      ]) {
        const page = await browser.newPage({
          viewport: { width: 1000, height: 134 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        });
        const cards = card('old', oldName, subtitle) + card('next', newName, subtitle, true);
        const content =
          mode === 'stats-slider'
            ? `<div class="stats-slider-wrapper" data-v-318f5eb8>${cards}</div>`
            : cards;
        await page.setContent(
          `<meta charset="utf-8"><style>${native}\n${css}\n${forceMotion ? ':root{--cm-roll-duration:.52s!important}' : ''}</style><div class="widget-stream-stats v-align-middle" data-v-318f5eb8><div class="${mode}" data-v-318f5eb8>${content}</div></div>`,
        );
        await page.evaluate(() => document.fonts.ready);
        const frames = await page.evaluate(async (mode) => {
          const shell = document.querySelector(`.${mode}`);
          const old = document.querySelector('#old');
          const next = document.querySelector('#next');
          const rect = (e) => {
            const r = e.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              top: r.top,
              bottom: r.bottom,
            };
          };
          const baseline = rect(shell);
          old.classList.add('fade-in-out-leave', 'fade-in-out-leave-active');
          next.style.display = '';
          next.classList.add('fade-in-out-enter', 'fade-in-out-enter-active');
          void next.offsetHeight;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          old.addEventListener(
            'transitionend',
            () => {
              old.style.display = 'none';
            },
            { once: true },
          );
          let incomingEnd = null;
          next.addEventListener(
            'transitionend',
            (event) => {
              incomingEnd = { property: event.propertyName, elapsed: event.elapsedTime };
              next.classList.remove('fade-in-out-enter-active');
            },
            { once: true },
          );
          old.classList.remove('fade-in-out-leave');
          old.classList.add('fade-in-out-leave-to');
          next.classList.remove('fade-in-out-enter');
          const started = performance.now();
          const samples = [];
          await new Promise((done) => {
            const tick = () => {
              const rows = [old, next]
                .filter((e) => getComputedStyle(e).display !== 'none')
                .map((e) => ({
                  ...rect(e.querySelector('.stats-item-main-row')),
                  opacity: +getComputedStyle(e).opacity,
                }));
              samples.push({
                shell: rect(shell),
                rows,
                background: getComputedStyle(shell).backgroundColor,
                angles: [old, next]
                  .filter((e) => getComputedStyle(e).display !== 'none')
                  .map((e) => getComputedStyle(e).rotate),
              });
              if (performance.now() - started > 650) done();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return {
            baseline,
            incomingEnd,
            samples,
            oldHidden: getComputedStyle(old).display === 'none',
            final: rect(next),
            overflow: next.scrollHeight > next.clientHeight + 1,
            finalRotate: getComputedStyle(next).rotate,
            finalScale: getComputedStyle(next).scale,
            duration: getComputedStyle(next).transitionDuration,
          };
        }, mode);
        assert(frames.samples.length > 5);
        assert(frames.incomingEnd, 'Provider receives the incoming transition completion');
        assert.notEqual(
          frames.incomingEnd.property,
          'filter',
          'Focus must not end the provider transition',
        );
        assert(
          Math.abs(frames.incomingEnd.elapsed - (reduced && !forceMotion ? 0.001 : 0.52)) < 0.01,
        );
        assert.equal(frames.baseline.height, 114);
        assert.equal(
          frames.oldHidden,
          true,
          'transitionend is applied and hides the outgoing donor',
        );
        assert.equal(frames.overflow, false, 'Two lines fit without vertical clipping');
        assert.equal(frames.finalRotate, 'x 0deg', 'Resting text is flat');
        assert.equal(frames.finalScale, '1', 'Resting text retains its full size');
        assert(
          frames.duration
            .split(',')
            .every(
              (value) => Number.parseFloat(value) === (reduced && !forceMotion ? 0.001 : 0.52),
            ),
        );
        if (!reduced || forceMotion)
          assert(
            frames.samples.some((frame) => frame.angles.some((angle) => angle !== 'x 0deg')),
            'The transition includes the proposed depth',
          );
        for (const frame of frames.samples) {
          assert.deepEqual(frame.shell, frames.baseline, 'Panel must never jump or resize');
          assert.equal(frame.background, 'rgb(244, 243, 236)');
          assert(
            frame.rows.some(
              (r) =>
                r.opacity === 1 && r.bottom > frame.shell.top + 1 && r.top < frame.shell.bottom - 1,
            ),
            'No blank text frame',
          );
          for (const row of frame.rows) assert.equal(row.opacity, 1, 'No fading');
          if (frame.rows.length === 2)
            assert(frame.rows[0].bottom <= frame.rows[1].top + 1, 'Names roll in separate rows');
        }
        assert.equal(frames.final.y, frames.baseline.y + 1);
        assert(frames.final.bottom <= 134);
        const { data, info } = await sharp(await page.screenshot({ omitBackground: true }))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const corner = ((Math.floor(frames.baseline.y) + 5) * info.width + 5) * 4 + 3;
        assert.equal(
          data[corner],
          0,
          'Surface corners remain visibly rounded after increasing panel height',
        );
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
