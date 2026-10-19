import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('website can be rebuilt repeatedly while retaining traversable nested directories', () => {
  const root = resolve(import.meta.dirname, '..');
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, [resolve(root, 'tooling/build-website.mjs')], {
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

test('all six Vue pages ship readable static HTML and retain only product scripts', () => {
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
    assert.equal(scripts.length, ['index.html', 'check.html'].includes(name) ? 1 : 0, name);
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
