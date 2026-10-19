import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright-core';

const sha = (value) => createHash('sha256').update(value).digest('base64');

// Only a loopback data endpoint. It never serves UI or executes Actions.
async function source() {
  let allowOrigin = true;
  const origins = [];
  const requests = [];
  const server = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: ({ origin }) => {
      origins.push(origin);
      return allowOrigin && origin === 'null';
    },
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  server.on('connection', (socket) => {
    let authenticated = false;
    socket.send(
      JSON.stringify({
        request: 'Hello',
        info: { version: '1.0.0', name: 'UI probe' },
        authentication: { salt: 'probe-salt', challenge: 'probe-challenge' },
      }),
    );
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      requests.push(message.request);
      const reply = (body) =>
        socket.send(JSON.stringify({ id: message.id, status: 'ok', ...body }));
      if (message.request === 'Authenticate') {
        authenticated =
          message.authentication === sha(sha('probe-onlyprobe-salt') + 'probe-challenge');
        return reply({ status: authenticated ? 'ok' : 'error' });
      }
      if (!authenticated) return reply({ status: 'error', error: 'Authentication required' });
      if (message.request === 'GetEvents') return reply({ events: { Custom: ['CodeEvent'] } });
      if (message.request === 'Subscribe') return reply({ events: message.events });
      if (message.request === 'DoAction') {
        assert.equal(message.action.id, 'probe-action');
        assert.equal(message.args.command, 'updateTwitch');
        const payload = JSON.parse(message.args.payloadJson);
        reply({});
        // CodeEvent is independent of the transport acknowledgement.
        socket.send(
          JSON.stringify({
            event: { source: 'Custom', type: 'CodeEvent' },
            data: {
              eventName: 'stream_info_api_response',
              args: {
                apiVersion: 4,
                command: message.args.command,
                requestId: message.args.requestId,
                ok: true,
                data: { title: payload.title },
                error: null,
              },
            },
          }),
        );
        return;
      }
      reply({ status: 'error', error: 'Unsupported request' });
    });
  });
  return {
    port: address.port,
    origins,
    requests,
    rejectOrigin() {
      allowOrigin = false;
    },
    acceptOrigin() {
      allowOrigin = true;
    },
    closeSockets() {
      for (const socket of server.clients) socket.close();
    },
    async close() {
      for (const socket of server.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function status(page, value) {
  await page.getByRole('status').filter({ hasText: value }).waitFor();
}

test(
  'file://: authenticated WS, form roundtrip, persistent profile, origin denial and CSP',
  { timeout: 60000 },
  async (t) => {
    const temp = await mkdtemp(path.join(tmpdir(), 'maseaaao-portability-'));
    const empty = path.join(temp, 'empty');
    await mkdir(empty);
    const html = await readFile(
      new URL('../../.build-cache/ui-portability/ui-portability.html', import.meta.url),
      'utf8',
    );
    assert(!/<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(html));
    assert(html.includes('data:font/woff2;base64,'));
    assert(!/new Function\(/.test(html), 'No runtime compiler');
    const file = path.join(empty, 'ui.html');
    await writeFile(file, html);
    const endpoint = await source();
    const errors = [];
    const dependencies = [];
    const violations = [];
    const options = {
      executablePath:
        process.env.CHROME_BIN || process.env.CHROME_PATH || chromium.executablePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    };
    let context;
    async function open() {
      context = await chromium.launchPersistentContext(path.join(temp, 'profile'), options);
      await context.addInitScript(() => {
        window.addEventListener('securitypolicyviolation', (event) => {
          document.documentElement.dataset.cspViolation = event.violatedDirective;
        });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (!request.url().startsWith('file:')) dependencies.push(request.url());
      });
      return page;
    }
    try {
      let page = await open();
      await page.goto(pathToFileURL(file).href);
      await page.getByLabel('Порт тестового источника').fill(String(endpoint.port));
      await page.getByRole('button', { name: 'Подключиться' }).click();
      await status(page, 'Подключено');
      await page.getByLabel('Название трансляции').fill('Проверка: русский текст и %subtitle%');
      await page.getByRole('button', { name: 'Отправить', exact: true }).click();
      await status(page, 'Ответ получен');
      assert.equal(
        await page.getByLabel('Ответ источника').textContent(),
        'Проверка: русский текст и %subtitle%',
      );
      await page.getByRole('button', { name: 'Сохранить настройки' }).click();
      await status(page, 'Настройки сохранены');
      await page.evaluate(() => document.fonts.ready);
      assert(await page.evaluate(() => document.fonts.check('600 20px Unbounded')));
      assert.equal(await page.locator('html').getAttribute('data-csp-violation'), null);
      t.diagnostic(
        `Chrome ${context.browser()?.version()}; ${process.platform}; HTML ${Buffer.byteLength(html)} bytes; first ready ${await page.evaluate(() => Math.round(performance.now()))} ms (includes interactions, not a startup budget)`,
      );
      await context.close();
      page = await open();
      await page.goto(pathToFileURL(file).href);
      assert.equal(
        await page.getByLabel('Название трансляции').inputValue(),
        'Проверка: русский текст и %subtitle%',
      );
      assert.equal(
        await page.getByLabel('Порт тестового источника').inputValue(),
        String(endpoint.port),
      );
      endpoint.rejectOrigin();
      await page.getByRole('button', { name: 'Подключиться' }).click();
      await status(page, 'Ошибка подключения');
      endpoint.acceptOrigin();
      await page.getByRole('button', { name: 'Подключиться' }).click();
      await status(page, 'Подключено');
      endpoint.closeSockets();
      await status(page, 'Отключено');
      await page.getByRole('button', { name: 'Подключиться' }).click();
      await status(page, 'Подключено');
      const moved = path.join(empty, 'moved.html');
      await writeFile(moved, html);
      await page.goto(pathToFileURL(moved).href);
      t.diagnostic(
        `Changed path settings title: ${JSON.stringify(await page.getByLabel('Название трансляции').inputValue())}; observed only, portability is not guaranteed`,
      );
      const strict = path.join(empty, 'strict.html');
      await writeFile(strict, html.replace('trusted-types vue', "trusted-types 'none'"));
      const strictPage = await context.newPage();
      strictPage.on('pageerror', () => {});
      await strictPage.goto(pathToFileURL(strict).href);
      await strictPage.waitForFunction(() => document.documentElement.dataset.cspViolation);
      violations.push(await strictPage.locator('html').getAttribute('data-csp-violation'));
      assert(
        violations.some((directive) => directive?.includes('trusted-types')),
        'Existing none policy is an explicit migration incompatibility',
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(dependencies, [], 'No HTTP requests for UI assets');
      assert(endpoint.origins.length >= 4 && endpoint.origins.every((origin) => origin === 'null'));
      for (const request of ['Authenticate', 'GetEvents', 'Subscribe', 'DoAction'])
        assert(endpoint.requests.includes(request), request);
    } finally {
      await context?.close();
      await endpoint.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
