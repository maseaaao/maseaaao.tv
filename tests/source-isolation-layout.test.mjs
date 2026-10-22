import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { snapshot } from '../tooling/source-snapshot.mjs';

/**
 * Dependency layouts differ between package managers: npm hoists a single
 * root node_modules, pnpm links a node_modules directory into every package
 * that declares dependencies. Source-isolation snapshots must ignore those
 * installation directories in both layouts.
 */
const root = resolve(import.meta.dirname, '..');

test('source snapshots ignore package-local dependency directories', () => {
  const scratch = resolve(root, '.build-cache/source-isolation-contract');
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(resolve(scratch, 'node_modules/left-pad'), { recursive: true });
  writeFileSync(resolve(scratch, 'node_modules/left-pad/index.js'), 'module.exports = 1;');
  writeFileSync(resolve(scratch, 'source.txt'), 'source');
  try {
    const rows = snapshot(root, '.build-cache/source-isolation-contract').map(([name]) =>
      name.replace(/\\/g, '/'),
    );
    assert.deepEqual(
      rows,
      ['.build-cache/source-isolation-contract/source.txt'],
      'only real sources belong to a snapshot',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
