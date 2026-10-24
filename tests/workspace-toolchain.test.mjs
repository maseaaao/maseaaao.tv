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
  assert.deepEqual(pkg.trustedDependencies, ['esbuild', 'sharp', 'workerd']);
  assert.match(read('bunfig.toml'), /linker\s*=\s*"isolated"/);
  assert(Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0);
  assert(!/\b(?:npm|pnpm)\b/.test(JSON.stringify(pkg.scripts)));
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
