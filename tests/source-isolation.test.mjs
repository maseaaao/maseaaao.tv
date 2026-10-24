import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import { snapshot } from './helpers/source-snapshot.mjs';

const root = resolve(import.meta.dirname, '..');

test('builds preserve sources, clean owned outputs and standalone builds preserve provider outputs', async () => {
  const sources = [
    'apps/website/src',
    'apps/obs-widgets/src',
    'apps/tuna-widget/src',
    'apps/stream-info/src',
    'packages/design',
    'packages/ui',
    'artwork/scenes',
    'artwork/banners',
    'artwork/brand',
    'apps/website/public',
  ];
  const before = sources.flatMap((directory) => snapshot(root, directory));
  const oldWebsite = snapshot(root, 'dist');
  execFileSync(process.execPath, ['tooling/build-artwork.mjs'], { cwd: root, stdio: 'pipe' });
  assert.deepEqual(
    snapshot(root, 'dist'),
    oldWebsite,
    'Artwork HTML build must not change the website',
  );
  execFileSync(process.execPath, ['tooling/build-website.mjs'], { cwd: root, stdio: 'pipe' });
  const website = snapshot(root, 'dist');
  const stale = resolve(root, 'apps/obs-widgets/dist/retired.css');
  writeFileSync(stale, 'stale fixture');
  execFileSync(process.execPath, ['tooling/build-widgets.mjs'], { cwd: root, stdio: 'pipe' });
  assert(!existsSync(stale), 'Removed outputs must not survive the next build');
  assert.deepEqual(
    snapshot(root, 'dist'),
    website,
    'Widget build must not change the website publication',
  );
  const configFile = resolve(root, 'apps/obs-widgets/vite.config.mjs');
  const siblings = ['streamlabs-chat', 'donors'];
  const preserved = siblings.flatMap((name) => snapshot(root, 'apps/obs-widgets/dist/' + name));
  await build({ configFile, mode: 'social-strip', logLevel: 'silent' });
  assert.deepEqual(
    siblings.flatMap((name) => snapshot(root, 'apps/obs-widgets/dist/' + name)),
    preserved,
    'Standalone build must not delete or rewrite provider assets',
  );
  assert.deepEqual(
    sources.flatMap((directory) => snapshot(root, directory)),
    before,
    'Builds must never rewrite source files',
  );
});
