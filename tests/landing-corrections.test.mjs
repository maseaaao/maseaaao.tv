import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import http from 'node:http';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

const root = resolve(import.meta.dirname, '..');
let browser, server, origin;
before(async () => {
  server = http.createServer((req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const pathnameFile = resolve(root, 'dist', '.' + decodeURIComponent(pathname));
      if (!pathnameFile.startsWith(resolve(root, 'dist') + sep)) throw Error('Invalid path');
      res.setHeader('Content-Type', {
        '.html': 'text/html; charset=utf-8', '.css': 'text/css',
        '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png',
      }[extname(pathnameFile)] || 'application/octet-stream');
      res.end(readFileSync(pathnameFile));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function visit(width, javascript = true) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: javascript, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(origin + '/')) external.push(request.url());
  });
  await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin + '/index.html');
  return { context, page, external };
}

test('static homepage works at every required width without Twitch media or network', async () => {
  for (const width of [320, 390, 540, 768, 900, 1024, 1440, 1920]) {
    const { context, page, external } = await visit(width);
    try {
      assert.equal(await page.locator('iframe, video, [data-stream-layout]').count(), 0);
      assert.equal(await page.locator('a[href="https://www.twitch.tv/maseaaao"]').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, String(width));
      assert.deepEqual(external, []);
    } finally {
      await context.close();
    }
  }
});

test('without JavaScript, visitors can still use Twitch and contact links', async () => {
  const { context, page } = await visit(390, false);
  try {
    assert.equal(await page.locator('.tile--twitch').isVisible(), true);
    assert.equal(await page.locator('a[href^="mailto:"]').isVisible(), true);
  } finally {
    await context.close();
  }
});
