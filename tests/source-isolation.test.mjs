import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
function snapshot(directory) {
  const rows = [];
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const name = directory + '/' + entry.name;
    if (entry.isDirectory()) rows.push(...snapshot(name));
    else
      rows.push([
        name,
        createHash('sha256')
          .update(readFileSync(resolve(root, name)))
          .digest('hex'),
      ]);
  }
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

test('builds preserve sources, clean owned outputs and never delete a sibling standalone widget', async () => {
  const sources = [
    'apps/website/src',
    'apps/obs-widgets/src',
    'apps/tuna-widget/src',
    'apps/stream-info/src',
    'packages/design',
    'packages/ui',
  ];
  const before = sources.flatMap(snapshot);
  execFileSync(process.execPath, ['tooling/build-website.mjs'], { cwd: root, stdio: 'pipe' });
  const website = snapshot('dist');
  const stale = resolve(root, 'apps/obs-widgets/dist/retired.css');
  writeFileSync(stale, 'stale fixture');
  execFileSync(process.execPath, ['tooling/build-widgets.mjs'], { cwd: root, stdio: 'pipe' });
  assert(!existsSync(stale), 'Removed outputs must not survive the next build');
  assert.deepEqual(
    snapshot('dist'),
    website,
    'Widget build must not change the website publication',
  );
  const configFile = resolve(root, 'apps/obs-widgets/vite.config.mjs');
  for (const [first, second] of [
    ['social-strip', 'output-stats'],
    ['output-stats', 'social-strip'],
  ]) {
    const preserved = snapshot('apps/obs-widgets/dist/' + first);
    await build({ configFile, mode: second, logLevel: 'silent' });
    assert.deepEqual(snapshot('apps/obs-widgets/dist/' + first), preserved);
  }
  assert.deepEqual(sources.flatMap(snapshot), before, 'Builds must never rewrite source files');
});
