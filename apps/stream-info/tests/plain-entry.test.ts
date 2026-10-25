import { expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const VUE_RE = /vue/;

it('authors a plain HTML entry without framework sources or dependencies', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  expect(
    Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) =>
      VUE_RE.test(name),
    ),
  ).toEqual([]);
  expect(
    readdirSync(resolve('src'), { recursive: true }).filter((name) =>
      String(name).endsWith('.vue'),
    ),
  ).toEqual([]);
  const html = readFileSync(resolve('src/index.html'), 'utf8');
  const { document } = new JSDOM(html).window;
  expect(document.querySelector('div#app')).not.toBeNull();
  expect(document.querySelector('script[type="module"][src="/main.ts"]')).not.toBeNull();
});
