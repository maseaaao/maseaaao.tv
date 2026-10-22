import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'tooling/release-products.json'), 'utf8'));
const workflow = parse(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8'));

test('the release manifest declares the products that get independent releases', () => {
  const ids = manifest.products.map((product) => product.id);
  assert.deepEqual(ids, ['stream-info', 'tuna-widget']);
  for (const product of manifest.products) {
    assert.match(product.id, /^[a-z][a-z-]*$/);
    assert.match(product.tagPrefix, new RegExp(`^${product.id}-v$`));
    assert.ok(product.artifacts.length > 0, product.id);
    for (const artifact of product.artifacts) assert.match(artifact, /\.html$/);
    assert.ok(product.test && product.build, product.id);
    assert.equal(typeof product.browser, 'boolean');
  }
});

test('the release workflow triggers exactly on the declared product tags', () => {
  const patterns = workflow.on.push.tags;
  assert.deepEqual(
    patterns,
    manifest.products.map((product) => `${product.tagPrefix}*`),
    'a new product needs its tag pattern in the workflow',
  );
});

test('the release workflow does not hardcode product names', () => {
  const source = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
  const body = source.slice(source.indexOf('jobs:'));
  for (const product of manifest.products) {
    // Product names may only appear in the tag trigger and the input hint.
    assert.doesNotMatch(body, new RegExp(product.id), `${product.id} must not be hardcoded`);
  }
  assert.match(source, /node tooling\/release-product\.mjs/);
  assert.doesNotMatch(source, /case "\$RELEASE_TAG"/);
});
