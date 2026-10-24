import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'tooling/release-products.json'), 'utf8'));
const workflow = parse(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8'));

test('the bundle catalog declares the products packed into the single release', () => {
  assert.equal(manifest.schemaVersion, 2);
  const ids = manifest.products.map((product) => product.id);
  assert.deepEqual(ids, [
    'stream-info',
    'tuna-widget',
    'obs-widgets',
    'artwork',
    'system-microphone',
    'voice-stream',
    'windows-integrations',
    'website',
  ]);
  for (const product of manifest.products) {
    assert.match(product.id, /^[a-z][a-z-]*$/);
    assert.equal(product.tagPrefix, undefined, 'bundle releases have no per-product tags');
    assert.ok(product.files.length > 0, product.id);
    for (const mapping of product.files) {
      assert.equal(typeof mapping.source, 'string');
      assert.equal(typeof mapping.target, 'string');
    }
    assert.ok(product.test && product.build, product.id);
    assert.ok(product.activation);
  }
});

test('the release workflow builds the whole bundle on bundle tags only', () => {
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  const source = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(source, /tooling\/bundle-release\.mjs --build/);
  assert.match(source, /tooling\/bundle-release\.mjs "\$RELEASE_TAG"/);
  assert.match(source, /softprops\/action-gh-release@v2/);
  assert.doesNotMatch(source, /windows-updater\.zip/);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.release.permissions.contents, 'write');
  assert.equal(Object.keys(workflow.jobs).length, 1);
  assert.doesNotMatch(source, /stream-info-v|website-v|artwork-v/);
});
