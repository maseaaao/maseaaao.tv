import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { generatedWebsiteImages } from '../tooling/website-assets.mjs';

const root = resolve(import.meta.dirname, '..');
const baseline = JSON.parse(readFileSync(join(root, 'docs/ui-renewal-baseline.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('artwork preserves approved logo, QR and all avatar bytes across the output move', () => {
  for (const entry of baseline.files.filter(
    (entry) =>
      ['artwork/logo/logo.png', 'apps/website/public/assets/maseaaao.tv.png'].includes(
        entry.path,
      ) || entry.path.startsWith('apps/website/public/assets/avatar-'),
  )) {
    const name = entry.path.includes('/avatar-')
      ? entry.path.replace('apps/website/public/', 'artwork/brand/rendered/website/')
      : entry.path;
    assert.equal(hash(readFileSync(join(root, name))), entry.sha256, name);
  }
});
test('all artwork envelopes come from Vite output with embedded local resources and bounded product JS', () => {
  let pages = 0;
  for (const directory of [
    'scenes',
    'banners',
    'brand',
    'logo',
    'wallpapers',
    'twitch-description',
  ]) {
    for (const name of readdirSync(join(root, 'artwork', directory)).filter((name) =>
      name.endsWith('.html'),
    )) {
      assert(existsSync(join(root, 'artwork', directory, name)), `${directory}/${name}`);
      const html = readFileSync(join(root, '.build-cache/artwork', directory, name), 'utf8');
      const { document } = new JSDOM(html).window;
      assert.equal(document.documentElement.lang, 'ru');
      assert.equal(document.querySelectorAll('main').length, 1, directory + '/' + name);
      assert.equal(document.querySelectorAll('script[src],link[rel="stylesheet"][href]').length, 0);
      for (const image of document.querySelectorAll('img,svg image'))
        assert((image.getAttribute('src') ?? image.getAttribute('href') ?? '').startsWith('data:'));
      const scripts = [...document.querySelectorAll('script:not([type="text/plain"])')];
      assert.equal(scripts.length, directory === 'banners' ? 1 : 0);
      assert(
        scripts.reduce((sum, element) => sum + Buffer.byteLength(element.textContent), 0) <= 2000,
      );
      const fonts = [...html.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)];
      assert.equal(fonts.length, 1);
      assert(
        Buffer.from(fonts[0][1], 'base64').equals(
          readFileSync(join(root, 'packages/design/fonts/unbounded-400.woff2')),
        ),
      );
      pages++;
    }
  }
  // The committed source set already contains 27 envelopes.
  assert.equal(pages, 27);
});
test('generated website resources have exactly one owner and collisions fail before publication', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'website-assets-'));
  try {
    await cp(
      join(root, 'artwork/brand/rendered/website'),
      join(directory, 'artwork/brand/rendered/website'),
      { recursive: true },
    );
    mkdirSync(join(directory, 'apps/website/public'), { recursive: true });
    assert.equal(generatedWebsiteImages(directory).size, 15);
    writeFileSync(join(directory, 'apps/website/public/og-image.jpg'), 'stale fixture');
    assert.throws(() => generatedWebsiteImages(directory), /collision: og-image.jpg/);
    rmSync(join(directory, 'apps/website/public/og-image.jpg'));
    rmSync(join(directory, 'artwork/brand/rendered/website/og-image.jpg'));
    assert.throws(() => generatedWebsiteImages(directory), /Missing or unexpected/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
