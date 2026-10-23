import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vueStandaloneConfig } from '@maseaaao/build-config/vue';
import { build } from 'vite';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

const fileName = 'change-info-streamer-bot.ru.html';
function matrixBuildConfig(
  outDir,
  root = fileURLToPath(new URL('../apps/stream-info/src', import.meta.url)),
) {
  const config = vueStandaloneConfig({
    root,
    outDir,
    fileName,
    budgets: { html: 400000, js: 220000 },
  });
  return { ...config, configFile: false, build: { ...config.build, emptyOutDir: false } };
}

// Build current source into scratch: never test stale dist or rewrite tracked outputs.
let directory;
let browser;
let url;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stream-info-matrix-'));
  await build(matrixBuildConfig(directory));
  url = pathToFileURL(join(directory, 'change-info-streamer-bot.ru.html')).href;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('scratch HTML budget reads fresh output without a dist directory', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'stream-info-budget-'));
  try {
    const root = join(isolated, 'src');
    const outDir = join(isolated, 'scratch');
    await mkdir(root);
    await mkdir(outDir);
    const config = matrixBuildConfig(outDir, root);
    const guard = config.plugins.find((plugin) => plugin.name === 'vue-runtime-contract');
    const html = join(outDir, fileName);
    await writeFile(html, '<!doctype html><title>Fresh scratch output</title>');
    await guard.writeBundle();
    await writeFile(html, 'x'.repeat(400001));
    await assert.rejects(() => guard.writeBundle(), /HTML budget exceeded: 400001 > 400000/);
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
});

async function fixture(intercept = () => false) {
  const context = await browser.newContext();
  const commands = [];
  const sockets = [];
  const errors = [];
  const state = {
    apiVersion: 4,
    twitch: {
      connected: true,
      live: false,
      login: 'fixture',
      title: 'Initial',
      categoryId: 'initial',
      categoryName: 'Initial category',
      tags: ['Original'],
    },
    templates: { twitchTemplate: '%subtitle%', subtitle: 'Initial', configured: true },
  };
  // All WebSockets terminate here; no connection to OBS/Streamer.bot is made.
  await context.routeWebSocket(/.*/, (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      const ack = (body = {}) =>
        socket.send(JSON.stringify({ id: message.id, status: 'ok', ...body }));
      if (message.request === 'GetEvents') return ack({ events: { Custom: ['CodeEvent'] } });
      if (message.request === 'Subscribe') return ack({ events: message.events });
      if (message.request === 'GetActions')
        return ack({
          actions: [
            { id: 'fixture-api', name: 'STREAM INFO | API', group: 'STREAM INFO', enabled: true },
            { id: 'fixture-preset', name: 'PRESET | Fixture', group: 'STREAM INFO', enabled: true },
          ],
        });
      if (message.request !== 'DoAction') return ack();
      const { command = 'preset', requestId, payloadJson = '{}' } = message.args;
      const payload = JSON.parse(payloadJson);
      const respond = (result = {}) => {
        let data = {};
        if (command === 'getState') data = state;
        if (command === 'saveTemplates' && result.ok !== false) {
          state.templates = { ...state.templates, ...payload };
          data = { templates: state.templates };
        }
        if (command === 'updateTwitch' && result.ok !== false) {
          if ('title' in payload) state.twitch.title = payload.title;
          if ('categoryId' in payload) state.twitch.categoryId = payload.categoryId;
          if ('tags' in payload) state.twitch.tags = payload.tags;
          data = {
            fields: Object.fromEntries(
              Object.keys(payload).map((key) => [key === 'categoryId' ? 'category' : key, true]),
            ),
          };
        }
        socket.send(
          JSON.stringify({
            event: { source: 'Custom', type: 'CodeEvent' },
            data: {
              eventName: 'stream_info_api_response',
              args: {
                apiVersion: 4,
                command,
                requestId,
                ok: true,
                data,
                error: null,
                ...result,
              },
            },
          }),
        );
      };
      const request = {
        command,
        payload,
        requestId,
        transportId: message.id,
        ack,
        respond,
        socket,
      };
      commands.push(request);
      if (intercept(request, state)) return;
      ack();
      if (command !== 'preset') setImmediate(respond);
    });
    socket.send(
      JSON.stringify({ request: 'Hello', info: { version: '1.0.7', name: 'Matrix fixture' } }),
    );
  });
  await context.addInitScript(() => {
    window.__matrixFrames = [];
    const original = WebSocket.prototype.dispatchEvent;
    WebSocket.prototype.dispatchEvent = function (event) {
      if (event instanceof MessageEvent && typeof event.data === 'string')
        window.__matrixFrames.push(JSON.parse(event.data));
      return original.call(this, event);
    };
  });
  const open = async () => {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(url);
    await page.getByLabel('Название', { exact: true }).waitFor();
    return page;
  };
  const page = await open();
  return { context, page, commands, sockets, state, open, errors };
}
const settings = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('change-info-streamer-bot.settings.v1')));
const apply = (page) =>
  page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
const tick = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function delivered(page, request, event = true) {
  await page.waitForFunction(
    ({ id, event }) =>
      window.__matrixFrames.some((frame) =>
        event ? frame.data?.args?.requestId === id : frame.id === id,
      ),
    { id: event ? request.requestId : request.transportId, event },
  );
  await tick(page);
}

test('event-first missing ACK times out; retry and same-context reopen keep only confirmed templates', {
  timeout: 60000,
}, async () => {
  const held = [];
  const f = await fixture((request) => {
    if (request.command !== 'saveTemplates') return false;
    held.push(request);
    return true;
  });
  try {
    const { page } = f;
    await page.clock.install();
    const template = page.getByLabel('Шаблон Twitch', { exact: true });
    await template.fill('First %subtitle%');
    const save = page.getByRole('button', { name: 'Применить изменения', exact: true });
    await save.click();
    assert.equal(held.length, 1);
    held[0].respond();
    await delivered(page, held[0]);
    await page.clock.fastForward(15000);
    await page.getByRole('alert').filter({ hasText: '15 секунд' }).waitFor();
    assert(await save.isEnabled());
    assert.equal((await settings(page)).twitchTemplate, '%subtitle%');
    await template.fill('Retry %subtitle%');
    await save.click();
    assert.equal(held.length, 2);
    held[0].ack();
    await delivered(page, held[0], false);
    assert(await save.isDisabled());
    assert.equal((await settings(page)).twitchTemplate, '%subtitle%');
    held[1].ack();
    held[1].respond();
    await page.getByText('Изменения применены', { exact: true }).waitFor();
    assert.equal((await settings(page)).twitchTemplate, 'Retry %subtitle%');
    await page.close();
    const reopened = await f.open();
    assert.equal(
      await reopened.getByLabel('Шаблон Twitch', { exact: true }).inputValue(),
      'Retry %subtitle%',
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.context.close();
  }
});

test('subtitle timeout retains the draft and confirmed storage; late ACK cannot race a successful retry', {
  timeout: 60000,
}, async () => {
  const held = [];
  const f = await fixture((request) => {
    if (request.command !== 'saveTemplates') return false;
    held.push(request);
    return true;
  });
  try {
    const { page } = f;
    await page.clock.install();
    const subtitle = page.getByLabel('Название', { exact: true });
    await subtitle.fill('Uncertain subtitle');
    await apply(page);
    assert.equal(held.length, 1);
    held[0].respond();
    await delivered(page, held[0]);
    await page.clock.fastForward(15000);
    await page.getByRole('alert').filter({ hasText: 'Подзаголовок не сохранён' }).waitFor();
    assert.equal(await subtitle.inputValue(), 'Uncertain subtitle');
    assert.equal((await settings(page)).lastSubtitle, 'Initial');
    assert.equal(f.commands.filter((request) => request.command === 'updateTwitch').length, 0);
    await subtitle.fill('Retry subtitle');
    await apply(page);
    assert.equal(held.length, 2);
    held[0].ack();
    await delivered(page, held[0], false);
    assert.equal((await settings(page)).lastSubtitle, 'Initial');
    assert.equal(f.commands.filter((request) => request.command === 'updateTwitch').length, 0);
    held[1].respond();
    held[1].ack();
    await page.getByText('Изменения применены', { exact: true }).waitFor();
    assert.equal((await settings(page)).lastSubtitle, 'Retry subtitle');
    assert.deepEqual(
      f.commands
        .filter((request) => request.command === 'updateTwitch')
        .map((request) => request.payload),
      [{ title: 'Retry subtitle' }],
    );
    await page.close();
    const reopened = await f.open();
    assert.equal(
      await reopened.getByLabel('Название', { exact: true }).inputValue(),
      'Retry subtitle',
    );
    assert.deepEqual(f.errors, []);
  } finally {
    await f.context.close();
  }
});

test('endpoint switch retires a pending write without success/auth and preserves a fresh draft', {
  timeout: 60000,
}, async () => {
  const held = [];
  const f = await fixture((request) => {
    if (request.command !== 'saveTemplates') return false;
    held.push(request);
    return true;
  });
  try {
    const { page } = f;
    const template = page.getByLabel('Шаблон Twitch', { exact: true });
    await template.fill('Retired %subtitle%');
    const save = page.getByRole('button', { name: 'Применить изменения', exact: true });
    await save.click();
    assert.equal(held.length, 1);
    await template.fill('Fresh %subtitle%');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByLabel('Endpoint', { exact: true }).fill('/matrix');
    await page.getByRole('button', { name: 'Сохранить подключение', exact: true }).click();
    await page.getByText('Streamer.bot подключён', { exact: true }).waitFor();
    assert.equal(f.sockets.length, 2);
    assert(f.sockets[1].url().endsWith('/matrix'));
    held[0].respond();
    held[0].ack({ status: 'error', error: 'password retired fixture' });
    await tick(page);
    assert.equal(
      await page.getByLabel('Шаблон Twitch', { exact: true }).inputValue(),
      'Fresh %subtitle%',
    );
    assert.equal((await settings(page)).endpoint, '/matrix');
    assert.equal((await settings(page)).twitchTemplate, '%subtitle%');
    assert.equal(await page.getByText('Шаблоны сохранены', { exact: true }).count(), 0);
    assert.equal(await page.locator('.auth-panel').count(), 0);
    await save.click();
    held[1].ack();
    held[1].respond();
    await page.getByText('Изменения применены', { exact: true }).waitFor();
    assert.equal((await settings(page)).twitchTemplate, 'Fresh %subtitle%');
    assert.deepEqual(f.errors, []);
  } finally {
    await f.context.close();
  }
});

test('partial metadata write retries only failed fields; preset refresh preserves local editors', {
  timeout: 60000,
}, async () => {
  let failed = false;
  const f = await fixture((request, state) => {
    if (request.command !== 'updateTwitch' || failed) return false;
    failed = true;
    state.twitch.title = request.payload.title;
    request.ack();
    request.respond({ ok: false, data: { fields: { title: true, tags: false } } });
    return true;
  });
  try {
    const { page } = f;
    await page.getByLabel('Название', { exact: true }).fill('Confirmed subtitle');
    await page.getByLabel('Добавить тег', { exact: true }).fill('Added');
    await page.getByLabel('Добавить тег', { exact: true }).press('Enter');
    await page.getByLabel('Добавить тег', { exact: true }).fill('Unsent');
    await apply(page);
    await page.getByRole('alert').filter({ hasText: 'Теги: ошибка' }).waitFor();
    assert.equal((await settings(page)).lastSubtitle, 'Confirmed subtitle');
    assert.equal(await page.getByLabel('Добавить тег', { exact: true }).inputValue(), 'Unsent');
    await apply(page);
    await page.getByText(/Остались несохранённые изменения/).waitFor();
    const writes = f.commands.filter((request) => request.command === 'updateTwitch');
    assert.deepEqual(
      writes.map((request) => request.payload),
      [
        { title: 'Confirmed subtitle', tags: ['Original', 'Added'] },
        { tags: ['Original', 'Added'] },
      ],
    );
    assert.equal(f.commands.filter((request) => request.command === 'saveTemplates').length, 1);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    // The separate "Полное название" mode no longer exists: the title is
    // always the template applied to the "Название" field.
    const title = page.getByLabel('Название', { exact: true });
    await title.fill('Local draft');
    f.state.twitch.title = 'Preset server title';
    f.state.templates = {
      twitchTemplate: 'Preset %subtitle%',
      subtitle: 'Preset subtitle',
      configured: true,
    };
    const before = f.commands.filter((request) => request.command === 'getState').length;
    await page.getByRole('button', { name: 'Fixture', exact: true }).click();
    await page.getByText('Action-пресет запущен', { exact: true }).waitFor();
    await page.clock.fastForward(699);
    assert.equal(f.commands.filter((request) => request.command === 'getState').length, before);
    await page.clock.fastForward(1);
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem('change-info-streamer-bot.settings.v1')).twitchTemplate ===
        'Preset %subtitle%',
    );
    assert.equal(await title.inputValue(), 'Local draft');
    assert.equal(await page.getByLabel('Добавить тег', { exact: true }).inputValue(), 'Unsent');
    assert.deepEqual(f.errors, []);
  } finally {
    await f.context.close();
  }
});

test('composition defers search and selection; failed continuation retries its cursor and merges by ID', {
  timeout: 60000,
}, async () => {
  let continuationFailed = false;
  const f = await fixture((request) => {
    if (request.command !== 'searchTwitchCategories') return false;
    request.ack();
    if (!request.payload.cursor)
      request.respond({
        data: {
          results: [{ id: 'one', name: '冒険 One' }],
          cursor: 'next',
          hasMore: true,
          partial: true,
          warnings: ['Fixture partial warning'],
        },
      });
    else if (!continuationFailed) {
      continuationFailed = true;
      request.respond({ ok: false, error: { message: 'Fixture continuation failure' } });
    } else
      request.respond({
        data: {
          results: [
            { id: 'one', name: '冒険 One' },
            { id: 'two', name: '冒険 Two' },
          ],
          hasMore: false,
          cursor: null,
        },
      });
    return true;
  });
  try {
    const { page } = f;
    await page.clock.install();
    const query = page.getByRole('combobox', { name: 'Категория', exact: true });
    await query.focus();
    await query.dispatchEvent('compositionstart', { data: '' });
    await query.evaluate((input) => {
      input.value = '冒険';
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: '冒険', isComposing: true }),
      );
    });
    await query.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await page.clock.fastForward(500);
    assert.equal(
      f.commands.filter((request) => request.command === 'searchTwitchCategories').length,
      0,
    );
    assert.equal(await query.inputValue(), '冒険');
    await query.dispatchEvent('compositionend', { data: '冒険' });
    // Browsers may emit an additional non-composing input after compositionend.
    await query.dispatchEvent('input');
    await page.clock.fastForward(250);
    await page.getByRole('option', { name: '冒険 One', exact: true }).waitFor();
    assert.equal(
      f.commands.filter((request) => request.command === 'searchTwitchCategories').length,
      1,
    );
    await query.press('ArrowDown');
    assert(await query.getAttribute('aria-activedescendant'));
    await query.dispatchEvent('compositionstart', { data: '' });
    await query.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await query.inputValue(), '冒険');
    assert.equal(await page.locator('.selected-category').innerText(), 'Initial category');
    await query.dispatchEvent('compositionend', { data: '冒険' });
    await page.clock.fastForward(250);
    await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture continuation failure' }).waitFor();
    assert.equal(await page.getByRole('option').count(), 1);
    await page.getByRole('button', { name: 'Повторить поиск', exact: true }).click();
    await page.getByRole('option', { name: '冒険 Two', exact: true }).waitFor();
    assert.equal(await page.getByRole('option').count(), 2);
    assert.deepEqual(
      f.commands
        .filter((request) => request.command === 'searchTwitchCategories')
        .slice(-2)
        .map((request) => request.payload),
      [
        { query: '冒険', cursor: 'next' },
        { query: '冒険', cursor: 'next' },
      ],
    );
    assert(await page.getByText('Fixture partial warning', { exact: true }).isVisible());
    await query.press('ArrowDown');
    await query.press('Enter');
    assert.equal(await query.inputValue(), '');
    assert.equal(await query.evaluate((input) => document.activeElement === input), true);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.context.close();
  }
});
