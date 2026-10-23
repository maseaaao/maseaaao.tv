import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
test('workspace uses one pinned pnpm installation contract', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.packageManager, 'pnpm@12.15.0');
  assert.match(read('pnpm-workspace.yaml'), /allowBuilds:/);
  assert(!/\bnpm run/.test(JSON.stringify(pkg.scripts)));
});

test('graph caches only reproducible outputs in this worktree', () => {
  const config = JSON.parse(read('turbo.json'));
  assert.equal(config.cacheDir, '.build-cache/turbo');
  assert(config.tasks.build.inputs.includes('!dist/**'));
  assert.equal(config.tasks.test.cache, false);
  assert(
    config.tasks['@maseaaao/ui-catalog#build'].dependsOn.includes('@maseaaao/obs-widgets#build'),
  );
  assert(config.tasks['@maseaaao/website#build'].outputs.includes('$TURBO_ROOT$/dist/**'));
  assert(
    config.tasks['@maseaaao/website#build'].inputs.includes(
      '$TURBO_ROOT$/artwork/brand/rendered/website/**',
    ),
  );
  assert.match(read('tooling/run-tasks.mjs'), /local:rw/);
});

test('Stream Info import verification reads pnpm workspace metadata', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const result = spawnSync(process.execPath, ['apps/stream-info/scripts/verify-import.mjs'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
