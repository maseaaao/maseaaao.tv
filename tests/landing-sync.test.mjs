import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const root = resolve(import.meta.dirname, '..');
test('homepage is static, has no third-party media and keeps main navigation', () => {
  const source = readFileSync(resolve(root, 'apps/website/src/components/HomePage.vue'), 'utf8');
  const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
  const index = readFileSync(resolve(root, 'apps/website/src/index.html'), 'utf8');
  for (const text of [source, index, html]) {
    assert.equal(text.includes('<iframe'), false);
    assert.equal(text.includes('player.twitch.tv'), false);
    assert.equal(text.includes('data-stream-layout'), false);
  }
  assert.equal(index.includes('assets/stream.js'), false);
  const { document } = new JSDOM(html).window;
  assert.equal(document.querySelectorAll('a[href="https://www.twitch.tv/maseaaao"]').length, 1);
  assert.equal(
    document.querySelectorAll('a[href="https://www.twitch.tv/maseaaao/videos"]').length,
    1,
  );
});
test('checker intentionally keeps diagnostic player controls', () => {
  const source = readFileSync(resolve(root, 'apps/website/src/assets/check.js'), 'utf8');
  assert(source.includes('player.twitch.tv'));
  assert(source.includes('youtube.com/embed/live_stream'));
});
