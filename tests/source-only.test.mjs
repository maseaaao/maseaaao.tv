import assert from 'node:assert/strict';
import { renameSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
const root = resolve(import.meta.dirname, '..');
test('source repository checks work without generated product/raster directories', () => {
  const folders = [
    'dist',
    'apps/stream-info/dist',
    'apps/tuna-widget/dist',
    'apps/obs-widgets/dist',
    'artwork/wallpapers/rendered',
  ];
  const moved = [];
  const backup = resolve(root, '.build-cache/source-contract');
  mkdirSync(backup, { recursive: true });
  try {
    for (const [index, directory] of folders.entries()) {
      const source = resolve(root, directory),
        target = resolve(backup, String(index));
      renameSync(source, target);
      moved.push([source, target]);
    }
    const result = spawnSync(process.execPath, ['tooling/check-repository.mjs', '--source'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    for (const [source, target] of moved.reverse()) renameSync(target, source);
  }
});
