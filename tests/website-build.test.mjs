import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('website can be rebuilt repeatedly while retaining traversable nested directories', () => {
  const root = resolve(import.meta.dirname, '..');
  const attributes = readFileSync(resolve(root, '.gitattributes'), 'utf8');
  for (const name of ['_headers', 'sitemap.xml', '.well-known/api-catalog'])
    assert(attributes.includes(`apps/website/public/${name} text eol=lf`));
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, ['run', 'build:website'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const name = '.well-known/api-catalog';
    assert(
      readFileSync(resolve(root, 'dist', name)).equals(
        readFileSync(resolve(root, 'apps/website/public', name)),
      ),
    );
    if (process.platform !== 'win32')
      assert(
        statSync(resolve(root, 'dist/.well-known')).mode & 0o100,
        'directories retain owner traversal permission',
      );
  }
});

test('all six pages ship readable static HTML and retain only product scripts', () => {
  const root = resolve(import.meta.dirname, '..');
  for (const name of [
    'index.html',
    'check.html',
    'docs.html',
    'tools/index.html',
    'tools/stream-info.html',
    'tools/tuna-widget.html',
  ]) {
    const html = readFileSync(resolve(root, 'dist', name), 'utf8');
    const { document } = new JSDOM(html).window;
    assert.equal(document.documentElement.lang, 'ru');
    assert.equal(document.querySelectorAll('h1').length, 1, name);
    assert(document.querySelector('main'), name);
    assert(!html.includes('<!--page-'), name);
    const scripts = [...document.querySelectorAll('script[src]')];
    assert.equal(scripts.length, name === 'check.html' ? 1 : 0, name);
    for (const script of scripts) {
      const source = readFileSync(
        resolve(root, 'dist', script.getAttribute('src').slice(1)),
        'utf8',
      );
      assert(Buffer.byteLength(source) < 5000, `${name}: product script stays below 5 KB`);
    }
    assert(Buffer.byteLength(html) < 25000, `${name}: static HTML budget`);
  }
});

test('homepage has one Twitch link, no Twitch SDK and no embedded player/chat', () => {
  const root = resolve(import.meta.dirname, '..');
  const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
  const { document } = new JSDOM(html).window;
  assert.equal(
    document.querySelectorAll('iframe, video, details, [data-stream-layout], [data-live-badge]')
      .length,
    0,
  );
  assert.equal(document.querySelectorAll('script[src]').length, 0);
  assert.equal(document.querySelectorAll('a[href="https://www.twitch.tv/maseaaao"]').length, 1);
  assert.equal(
    document.querySelectorAll('a[href="https://www.twitch.tv/maseaaao/videos"]').length,
    1,
  );
});
