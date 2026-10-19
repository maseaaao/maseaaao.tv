import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, statSync } from 'node:fs';

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
