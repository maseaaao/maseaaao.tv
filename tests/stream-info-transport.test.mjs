import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

// Protocol-shaped fixture: acknowledgement and Custom.CodeEvent are distinct.
// No connectToServer(): the real client runs, but no live/local service is reached.
async function mockTransport(context, commands, intercept) {
  const state = {
    apiVersion: 4,
    twitch: {
      connected: true,
      live: false,
      login: 'fixture',
      title: 'Исходное название',
      categoryId: '509658',
      categoryName: 'Just Chatting',
      categoryImageUrl: '',
      tags: ['Русский'],
    },
    templates: { twitchTemplate: '%subtitle%', subtitle: 'Исходное название', configured: true },
  };
  await context.routeWebSocket(/.*/, (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      const reply = (body) =>
        socket.send(JSON.stringify({ id: message.id, status: 'ok', ...body }));
      if (message.request === 'GetEvents') return reply({ events: { Custom: ['CodeEvent'] } });
      if (message.request === 'Subscribe') return reply({ events: message.events });
      if (message.request === 'GetActions')
        return reply({
          actions: [
            { id: 'fixture-api', name: 'STREAM INFO | API', group: 'STREAM INFO', enabled: true },
          ],
        });
      if (message.request !== 'DoAction') return reply({});
      assert.equal(message.action.id, 'fixture-api');
      const { command, requestId, payloadJson } = message.args;
      const payload = JSON.parse(payloadJson);
      commands.push({ command, payload });
      const respond = (result = {}) => {
        let data = {};
        if (command === 'getState') data = state;
        if (command === 'saveTemplates') {
          state.templates = { ...state.templates, ...payload };
          data = { templates: state.templates };
        }
        if (command === 'updateTwitch') {
          state.twitch = { ...state.twitch, ...payload };
          data = { fields: { title: true, category: true, tags: true } };
        }
        if (command === 'searchTwitchCategories') data = { results: [], hasMore: false };
        socket.send(
          JSON.stringify({
            event: { source: 'Custom', type: 'CodeEvent' },
            data: {
              eventName: 'stream_info_api_response',
              args: { apiVersion: 4, command, requestId, ok: true, data, error: null, ...result },
            },
          }),
        );
      };
      if (
        intercept?.({
          command,
          payload,
          requestId,
          transportId: message.id,
          ack: reply,
          respond,
          disconnect: () => socket.close(),
        })
      )
        return;
      reply({});
      setImmediate(respond);
    });
    socket.send(
      JSON.stringify({ request: 'Hello', info: { version: '1.0.7', name: 'Stream Info fixture' } }),
    );
  });
}

test(
  'Stream Info built file:// uses the real client protocol and preserves settings on reopen',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stream-info-transport-'));
    const file = join(directory, 'dock.html');
    const browser = await launchBrowser();
    const commands = [];
    try {
      await cp(
        new URL('../apps/stream-info/dist/change-info-streamer-bot.ru.html', import.meta.url),
        file,
      );
      const context = await browser.newContext();
      await mockTransport(context, commands);
      await context.addInitScript(() => {
        const key = 'change-info-streamer-bot.settings.v1';
        if (!localStorage.getItem(key))
          localStorage.setItem(
            key,
            JSON.stringify({
              host: '127.0.0.1',
              port: 60666,
              endpoint: '/',
              rememberPassword: false,
            }),
          );
      });
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(file).href);
      const subtitle = page.getByLabel(/^(Подзаголовок|Тема стрима)$/);
      await subtitle.waitFor();
      await subtitle.fill('Проверка автономного Vue-дока');
      await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
      await page.waitForFunction(() => document.body.textContent.includes('Изменения применены'));
      assert(
        commands.some(
          (entry) =>
            entry.command === 'updateTwitch' &&
            entry.payload.title === 'Проверка автономного Vue-дока',
        ),
      );
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('change-info-streamer-bot.settings.v1')),
      );
      assert.equal(saved.port, 60666);
      assert.equal(saved.password, '');
      await page.close();
      const reopened = await context.newPage();
      await reopened.goto(pathToFileURL(file).href);
      await reopened.getByLabel(/^(Подзаголовок|Тема стрима)$/).waitFor();
      assert.equal(
        await reopened.getByLabel(/^(Подзаголовок|Тема стрима)$/).inputValue(),
        'Проверка автономного Vue-дока',
      );
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

for (const order of ['ack-first', 'event-first', 'ack-error', 'missing-event']) {
  test(
    `Stream Info built file:// independently completes ACK and CodeEvent: ${order}`,
    { timeout: 60000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'stream-info-ack-'));
      const file = join(directory, 'dock.html');
      const browser = await launchBrowser();
      try {
        await cp(
          new URL('../apps/stream-info/dist/change-info-streamer-bot.ru.html', import.meta.url),
          file,
        );
        const context = await browser.newContext();
        let receive;
        const incoming = new Promise((resolve) => {
          receive = resolve;
        });
        await mockTransport(context, [], (request) => {
          if (request.command !== 'saveTemplates') return false;
          receive(request);
          return true;
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route(/^https?:/, (route) => route.abort());
        await page.goto(pathToFileURL(file).href);
        await page.getByLabel('Тема стрима', { exact: true }).waitFor();
        // Routed sockets are EventTargets, not network sockets exposed by CDP.
        // Observe delivery without replacing the real client's handlers.
        await page.evaluate(() => {
          window.__streamInfoFixtureFrames = [];
          const dispatch = WebSocket.prototype.dispatchEvent;
          WebSocket.prototype.dispatchEvent = function (event) {
            if (event instanceof MessageEvent && typeof event.data === 'string')
              window.__streamInfoFixtureFrames.push(JSON.parse(event.data));
            return dispatch.call(this, event);
          };
        });
        if (order === 'missing-event') await page.clock.install();
        await page.getByRole('button', { name: 'Настройки', exact: true }).click();
        await page.getByLabel('Шаблон Twitch', { exact: true }).fill('Новый %subtitle%');
        const save = page.getByRole('button', { name: 'Сохранить шаблоны', exact: true });
        await save.click();
        const held = await incoming;
        assert.equal(held.payload.twitchTemplate, 'Новый %subtitle%');
        const dirty = page.getByText('Есть несохранённые изменения шаблонов', { exact: true });
        const dialog = page.getByRole('dialog');
        const success = dialog.getByRole('status').filter({ hasText: 'Шаблоны сохранены' });
        const send = async (phase) => {
          if (phase === 'event') held.respond();
          else
            held.ack(order === 'ack-error' ? { status: 'error', error: 'Fixture rejection' } : {});
          await page.waitForFunction(
            ({ phase, requestId, transportId }) =>
              window.__streamInfoFixtureFrames.some((frame) =>
                phase === 'event'
                  ? frame.data?.args?.requestId === requestId
                  : frame.id === transportId,
              ),
            { phase, requestId: held.requestId, transportId: held.transportId },
          );
        };
        if (order === 'ack-error' || order === 'missing-event') {
          await send('ack');
          if (order === 'missing-event') {
            assert(await save.isDisabled());
            assert.equal(
              await success.count(),
              0,
              'ACK alone must not confirm an application write',
            );
            await page.clock.fastForward(15000);
          }
          await dialog
            .getByRole('alert')
            .filter({ hasText: 'Не удалось сохранить шаблоны' })
            .waitFor();
          assert(await dirty.isVisible());
          assert(await save.isEnabled());
          assert.equal(await success.count(), 0);
          if (order === 'missing-event') {
            assert(
              await page
                .getByText('Streamer.bot не прислал ответ за 15 секунд.', { exact: true })
                .isVisible(),
            );
          }
          await send('event');
          assert.equal(
            await success.count(),
            0,
            'A late CodeEvent after failure cannot confirm the draft',
          );
          assert(await dirty.isVisible());
        } else {
          await send(order === 'event-first' ? 'event' : 'ack');
          assert(await save.isDisabled(), 'Both protocol completions are required');
          assert(await dirty.isVisible());
          assert.equal(await success.count(), 0);
          await send(order === 'event-first' ? 'ack' : 'event');
          await success.waitFor();
          assert.equal(await dirty.count(), 0);
          assert(await save.isEnabled());
        }
        const failed = order === 'ack-error' || order === 'missing-event';
        const feedback = dialog
          .getByRole(failed ? 'alert' : 'status')
          .filter({ hasText: failed ? 'Не удалось сохранить шаблоны' : 'Шаблоны сохранены' });
        assert(await feedback.isVisible(), 'Save feedback must be inside the active dialog');
        await feedback.getByRole('button', { name: 'Закрыть уведомление', exact: true }).click();
        await feedback.waitFor({ state: 'detached' });
        assert(await dialog.isVisible(), 'Dismissing feedback must keep settings open');
        assert.deepEqual(errors, []);
        await context.close();
      } finally {
        await browser.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

test(
  'changing only full Twitch title does not send a redundant saveTemplates command',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stream-info-title-'));
    const browser = await launchBrowser();
    const commands = [];
    try {
      const file = join(directory, 'dock.html');
      await cp(
        new URL('../apps/stream-info/dist/change-info-streamer-bot.ru.html', import.meta.url),
        file,
      );
      const context = await browser.newContext();
      await mockTransport(context, commands);
      const page = await context.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.getByLabel('Тема стрима', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Полное название', exact: true }).click();
      await page.getByLabel('Полное название', { exact: true }).fill('Новое название стрима');
      await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
      await page.waitForFunction(() => document.body.textContent.includes('Изменения применены'));
      assert.equal(commands.filter((entry) => entry.command === 'saveTemplates').length, 0);
      assert(
        commands.some(
          (entry) =>
            entry.command === 'updateTwitch' && entry.payload.title === 'Новое название стрима',
        ),
      );
      await context.close();
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

for (const failure of ['ack-reject', 'backend-reject', 'timeout', 'disconnect'])
  test(
    `failed subtitle persistence preserves confirmed storage and the draft: ${failure}`,
    { timeout: 60000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'stream-info-rejected-'));
      const browser = await launchBrowser();
      try {
        const file = join(directory, 'dock.html');
        await cp(
          new URL('../apps/stream-info/dist/change-info-streamer-bot.ru.html', import.meta.url),
          file,
        );
        const context = await browser.newContext();
        await mockTransport(context, [], (request) => {
          if (request.command !== 'saveTemplates') return false;
          if (failure === 'ack-reject')
            request.ack({ status: 'error', error: 'Fixture rejection' });
          else if (failure === 'disconnect') request.disconnect();
          else {
            request.ack({});
            if (failure === 'backend-reject')
              request.respond({ ok: false, error: { message: 'Fixture backend rejection' } });
          }
          return true;
        });
        const page = await context.newPage();
        await page.goto(pathToFileURL(file).href);
        const subtitle = page.getByLabel('Тема стрима', { exact: true });
        await subtitle.waitFor();
        await page.waitForFunction(
          () =>
            JSON.parse(localStorage.getItem('change-info-streamer-bot.settings.v1') || '{}')
              .lastSubtitle === 'Исходное название',
        );
        await subtitle.fill('Не подтверждённая тема');
        if (failure === 'timeout' || failure === 'disconnect') await page.clock.install();
        await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
        if (failure === 'timeout') await page.clock.fastForward(15001);
        if (failure === 'disconnect')
          await page.getByText('Streamer.bot не подключён', { exact: true }).first().waitFor();
        else
          await page
            .getByText('Подзаголовок не сохранён в Streamer.bot', { exact: false })
            .waitFor();
        const saved = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('change-info-streamer-bot.settings.v1')),
        );
        assert.equal(saved.lastSubtitle, 'Исходное название');
        assert.equal(await subtitle.inputValue(), 'Не подтверждённая тема');
        await context.close();
      } finally {
        await browser.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

test('reverted subtitle edit does not send any templates write', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stream-info-revert-'));
  const browser = await launchBrowser();
  const commands = [];
  try {
    const file = join(directory, 'dock.html');
    await cp(
      new URL('../apps/stream-info/dist/change-info-streamer-bot.ru.html', import.meta.url),
      file,
    );
    const context = await browser.newContext();
    await mockTransport(context, commands);
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href);
    const subtitle = page.getByLabel('Тема стрима', { exact: true });
    await subtitle.waitFor();
    await subtitle.fill('Временный черновик');
    await subtitle.fill('Исходное название');
    await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes('Изменения применены'));
    assert.equal(commands.filter((row) => row.command === 'saveTemplates').length, 0);
    await context.close();
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
