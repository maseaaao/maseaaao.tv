import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

async function paginationFixture(context) {
  const searches = [];
  const state = {
    apiVersion: 4,
    twitch: {
      connected: true,
      live: false,
      login: 'fixture',
      title: 'Pagination fixture',
      categoryId: 'current',
      categoryName: 'Current category',
      tags: ['Русский'],
    },
    templates: { twitchTemplate: '%subtitle%', subtitle: 'Pagination fixture', configured: true },
  };
  // The real client talks only to this routed socket, never to a live service.
  await context.routeWebSocket(/.*/, (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      const ack = (body = {}) =>
        socket.send(JSON.stringify({ id: message.id, status: 'ok', ...body }));
      if (message.request === 'GetEvents') return ack({ events: { Custom: ['CodeEvent'] } });
      if (message.request === 'Subscribe') return ack({ events: message.events });
      if (message.request === 'GetActions')
        return ack({
          actions: [
            {
              id: 'pagination-api',
              name: 'STREAM INFO | API',
              group: 'STREAM INFO',
              enabled: true,
            },
          ],
        });
      if (message.request !== 'DoAction') return ack();
      assert.equal(message.action.id, 'pagination-api');
      const { command, requestId, payloadJson } = message.args;
      const respond = (envelope) =>
        socket.send(
          JSON.stringify({
            event: { source: 'Custom', type: 'CodeEvent' },
            data: {
              eventName: 'stream_info_api_response',
              args: { apiVersion: 4, command, requestId, ok: true, error: null, ...envelope },
            },
          }),
        );
      ack();
      if (command === 'searchTwitchCategories') {
        searches.push({ payload: JSON.parse(payloadJson), respond });
      } else {
        assert.equal(command, 'getState');
        respond({ data: state });
      }
    });
    socket.send(JSON.stringify({ request: 'Hello', info: { version: '1.0.7' } }));
  });
  return searches;
}

async function withPagination(
  run,
  firstPage = { results: [{ id: 'one', name: 'Adventure one' }], cursor: 'next', hasMore: true },
) {
  const directory = await mkdtemp(join(tmpdir(), 'stream-info-pagination-'));
  let browser;
  try {
    browser = await launchBrowser();
    const file = join(directory, 'dock.html');
    await cp(
      new URL('../apps/stream-info/dist/change-info-streamer-bot.ru.html', import.meta.url),
      file,
    );
    const context = await browser.newContext();
    const searches = await paginationFixture(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(file).href);
    const input = page.getByRole('combobox', { name: 'Категория', exact: true });
    await input.fill('Adventure');
    await page.waitForFunction(
      () => document.querySelector('[role="combobox"]')?.getAttribute('aria-expanded') === 'true',
    );
    await waitForSearch(searches, 1);
    searches[0].respond({ data: firstPage });
    await page.getByRole('option').first().waitFor();
    await run({ page, input, searches });
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function waitForSearch(searches, count) {
  // Node-side routed messages are independent from page rendering.
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const poll = () => {
      if (searches.length === count) return resolve();
      if (Date.now() >= deadline)
        return reject(new Error(`Expected ${count} searches, got ${searches.length}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function focusedTag(page) {
  return page.evaluate(() => document.activeElement?.tagName);
}

async function assertFocused(locator, message) {
  assert.equal(
    await locator.evaluate((element) => element === document.activeElement),
    true,
    message,
  );
}

test(
  'built file:// pagination retains focus while loading, blocks repeats and supports retry',
  { timeout: 30000 },
  async () => {
    await withPagination(async ({ page, input, searches }) => {
      const more = page.getByRole('button', { name: 'Показать ещё', exact: true });
      await more.focus();
      await page.keyboard.press('Enter');
      await waitForSearch(searches, 2);
      await page.getByRole('status').filter({ hasText: 'Ищем категории…' }).waitFor();
      await assertFocused(more, `Loading pagination lost focus to ${await focusedTag(page)}`);
      assert.equal(await more.getAttribute('aria-disabled'), 'true');
      assert.equal(await more.evaluate((element) => element.disabled), false);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      await more.evaluate((element) => element.click());
      assert.equal(searches.length, 2, 'Repeat activation must not queue another page');
      searches[1].respond({
        data: { results: [{ id: 'two', name: 'Adventure two' }], cursor: 'last', hasMore: true },
      });
      await page.getByRole('option', { name: 'Adventure two', exact: true }).waitFor();
      await assertFocused(more, 'Successful continuation must retain the same action focus');
      assert.notEqual(await more.getAttribute('aria-disabled'), 'true');
      assert.equal(searches.length, 2);
      assert.deepEqual(searches[1].payload, { query: 'Adventure', cursor: 'next' });

      await page.keyboard.press('Enter');
      await waitForSearch(searches, 3);
      searches[2].respond({ ok: false, data: null, error: { message: 'Page failed' } });
      await page.getByRole('alert').filter({ hasText: 'Page failed' }).waitFor();
      await assertFocused(more, 'Failure must retain the focused pagination action');
      assert.equal(await page.getByRole('option').count(), 2);
      await page.getByRole('button', { name: 'Повторить поиск', exact: true }).click();
      await waitForSearch(searches, 4);
      assert.deepEqual(searches[3].payload, searches[2].payload);
      assert.deepEqual(searches[3].payload, { query: 'Adventure', cursor: 'last' });
      // Restore focus to the pagination action before its final-page removal.
      await more.focus();
      searches[3].respond({
        data: { results: [{ id: 'three', name: 'Adventure three' }], cursor: null, hasMore: false },
      });
      await more.waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('option').count(), 3);
      await assertFocused(input, 'Final-page removal must return focus to the category input');
      assert.equal(searches.length, 4);
    });
  },
);

test(
  'built file:// final local batch returns pagination focus without another request',
  { timeout: 30000 },
  async () => {
    await withPagination(
      async ({ page, input, searches }) => {
        assert.equal(await page.getByRole('option').count(), 20);
        const more = page.getByRole('button', { name: 'Показать ещё', exact: true });
        await more.focus();
        await page.keyboard.press('Enter');
        await more.waitFor({ state: 'detached' });
        assert.equal(await page.getByRole('option').count(), 21);
        await assertFocused(input, 'Exhausting a local batch must also return focus to the input');
        assert.equal(searches.length, 1);
      },
      {
        results: [
          { id: 'one', name: 'Adventure one' },
          ...Array.from({ length: 20 }, (_, index) => ({
            id: `local-${index}`,
            name: `Adventure ${index}`,
          })),
        ],
        cursor: null,
        hasMore: false,
      },
    );
  },
);

for (const target of ['elsewhere', 'disposed']) {
  test(
    `built file:// final pagination does not steal focus when ${target}`,
    { timeout: 30000 },
    async () => {
      await withPagination(async ({ page, searches }) => {
        const more = page.getByRole('button', { name: 'Показать ещё', exact: true });
        await more.click();
        await waitForSearch(searches, 2);
        const destination =
          target === 'disposed'
            ? page.getByRole('switch', { name: 'Обновлять Twitch', exact: true })
            : page.getByLabel('Тема стрима', { exact: true });
        if (target === 'disposed') {
          await destination.focus();
          await page.keyboard.press('Space');
        }
        await destination.focus();
        searches[1].respond({ data: { results: [], cursor: null, hasMore: false } });
        if (target === 'elsewhere') await more.waitFor({ state: 'detached' });
        else {
          await page.getByRole('combobox').waitFor({ state: 'detached' });
          // Remount only after disposal; the final result must not refocus either input.
          await page.keyboard.press('Space');
          await page.getByRole('status').filter({ hasText: 'Результатов: 1' }).waitFor();
        }
        await assertFocused(destination, 'A retired/unfocused search must not take focus back');
        assert.equal(
          await page.getByRole('button', { name: 'Показать ещё', exact: true }).count(),
          0,
        );
      });
    },
  );
}
