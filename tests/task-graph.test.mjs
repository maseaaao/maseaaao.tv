import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
test('workspace uses one pinned Bun installation contract', () => {
  const pkg = JSON.parse(read('package.json'));
  const version = read('.bun-version').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.packageManager, `bun@${version}`);
  assert.equal(pkg.engines.bun, version);
  assert.deepEqual(pkg.trustedDependencies, ['esbuild', 'sharp']);
  assert.match(read('bunfig.toml'), /linker\s*=\s*"isolated"/);
  assert(Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0);
  assert(!/\b(?:npm|pnpm)\b/.test(JSON.stringify(pkg.scripts)));
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

test('Stream Info import verification reads Bun workspace metadata', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const result = spawnSync(process.execPath, ['apps/stream-info/scripts/verify-import.mjs'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
