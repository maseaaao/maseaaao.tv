import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('authors a plain HTML entry without framework sources or dependencies', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  expect(
    Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => /vue/.test(name)),
  ).toEqual([]);
  expect(
    readdirSync(resolve('src'), { recursive: true }).filter((name) =>
      String(name).endsWith('.vue'),
    ),
  ).toEqual([]);
  const html = readFileSync(resolve('src/index.html'), 'utf8');
  expect(html).toContain('<div id="app"');
  expect(html).toContain('src="/main.ts"');
});
