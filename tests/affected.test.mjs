import assert from 'node:assert/strict';
import test from 'node:test';
test('affected selection follows transitive workspace consumers', async () => {
  const { selectAffected, readWorkspaces } = await import('../tooling/affected.mjs');
  const plan = selectAffected(['packages/design/brand.css'], readWorkspaces());
  assert(plan.products && plan.raster);
  assert(!plan.companion);
  for (const name of [
    '@maseaaao/website',
    '@maseaaao/ui-catalog',
    '@maseaaao/artwork',
    '@maseaaao/tuna-widget',
  ])
    assert(plan.packages.includes(name), name);
});

test('root, missing base, deleted unknown files and safety nets select everything', async () => {
  const { selectAffected, readWorkspaces } = await import('../tooling/affected.mjs');
  for (const files of [['pnpm-lock.yaml'], ['turbo.json'], ['tooling/removed.mjs']]) {
    const plan = selectAffected(files, readWorkspaces());
    assert(plan.full && plan.products && plan.raster && plan.companion);
  }
  assert(selectAffected([], readWorkspaces(), true).full);
  const docs = selectAffected(['docs/architecture.md'], readWorkspaces());
  assert(docs.source && !docs.products && !docs.raster && !docs.companion);
});
test('Companion changes cannot silently skip archive verification', async () => {
  const { selectAffected, readWorkspaces } = await import('../tooling/affected.mjs');
  const plan = selectAffected(['integrations/companion/voice-control/index.mjs'], readWorkspaces());
  assert(plan.companion && !plan.raster && !plan.products);
});
test('aggregate fails closed for failed, cancelled, or unexpected skipped checks', async () => {
  const { assertResults } = await import('../tooling/ci-result.mjs');
  const plan = { products: true, raster: false, companion: false };
  const good = {
    plan: { result: 'success' },
    source: { result: 'success' },
    products: { result: 'success' },
    raster: { result: 'skipped' },
    companion: { result: 'skipped' },
  };
  assert.doesNotThrow(() => assertResults(plan, good));
  for (const result of ['failure', 'cancelled', 'skipped', undefined])
    assert.throws(() => assertResults(plan, { ...good, products: { result } }));
  assert.throws(() => assertResults(plan, { ...good, source: { result: 'skipped' } }));
  assert.throws(() => assertResults({}, good));
});
