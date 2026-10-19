import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../artwork/browser.mjs';

test('static page, interactive island and artwork work from an empty file directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vue-delivery-'));
  const browser = await launchBrowser();
  try {
    await mkdir(join(directory, 'examples'));
    for (const name of ['index', 'interactive', 'examples/artwork'])
      await cp(
        new URL(`../../.build-cache/static-fixtures/${name}.html`, import.meta.url),
        join(directory, `${name}.html`),
      );
    for (const name of ['index', 'interactive', 'examples/artwork']) {
      const html = await readFile(join(directory, `${name}.html`), 'utf8');
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
        (match) => !match[1].includes('text/plain'),
      );
      if (name !== 'interactive')
        assert.equal(scripts.length, 0, 'Static content ships no executable JS');
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = [];
      const dependencies = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (
          !request.url().startsWith('data:') &&
          request.url() !== pathToFileURL(join(directory, `${name}.html`)).href
        )
          dependencies.push(request.url());
      });
      await page.goto(pathToFileURL(join(directory, `${name}.html`)).href);
      await page.evaluate(() => document.fonts.ready);
      assert(await page.evaluate(() => document.fonts.check('400 20px Unbounded')));
      if (name === 'interactive') {
        const button = page.getByRole('button', { name: 'Изменить' });
        await button.click();
        await button.press('Enter');
        assert.equal(await page.locator('output').textContent(), 'Значение: 2');
      } else {
        assert((await page.getByRole('heading').textContent()).length > 0);
      }
      if (name === 'examples/artwork') {
        const size = await page.locator('main').evaluate((element) => {
          const box = element.getBoundingClientRect();
          return [box.width, box.height];
        });
        assert.deepEqual(size, [1200, 480]);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(dependencies, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
