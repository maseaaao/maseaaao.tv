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
  for (const files of [['bun.lock'], ['turbo.json'], ['tooling/removed.mjs']]) {
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
    'ui-tests': { result: 'success' },
    'repository-tests': { result: 'success' },
    'stream-info-tests': { result: 'success' },
    raster: { result: 'skipped' },
    companion: { result: 'skipped' },
  };
  assert.doesNotThrow(() => assertResults(plan, good));
  for (const result of ['failure', 'cancelled', 'skipped', undefined])
    assert.throws(() => assertResults(plan, { ...good, products: { result } }));
  assert.throws(() => assertResults(plan, { ...good, source: { result: 'skipped' } }));
  assert.throws(() => assertResults({}, good));
});

test('push ranges compare endpoints while PR ranges use the merge base', async () => {
  const { changedFiles } = await import('../tooling/affected.mjs');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ci-ranges-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'user.name', 'CI test');
    writeFileSync(join(dir, 'initial'), 'initial');
    git('add', '.');
    git('commit', '-m', 'initial');
    const initial = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'old-only'), 'old');
    git('add', '.');
    git('commit', '-m', 'old tip');
    const before = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'rewritten', initial);
    writeFileSync(join(dir, 'new-only'), 'new');
    git('add', '.');
    git('commit', '-m', 'new tip');
    assert.deepEqual(changedFiles(before, 'push', dir).sort(), ['new-only', 'old-only']);
    assert.deepEqual(changedFiles(before, 'pull_request', dir), ['new-only']);
    assert.throws(() => changedFiles('not-a-sha', 'push', dir), /base|SHA/i);
    assert.throws(() => changedFiles('0'.repeat(40), 'push', dir), /base|SHA/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aggregate rejects every failed selected stage including matrix result', async () => {
  const { assertResults } = await import('../tooling/ci-result.mjs');
  const plan = { products: true, raster: true, companion: true };
  const jobs = [
    'plan',
    'source',
    'products',
    'ui-tests',
    'repository-tests',
    'stream-info-tests',
    'raster',
    'companion',
  ];
  const good = Object.fromEntries(jobs.map((job) => [job, { result: 'success' }]));
  assert.doesNotThrow(() => assertResults(plan, good));
  for (const job of jobs) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined])
      assert.throws(() => assertResults(plan, { ...good, [job]: { result } }), job);
  }
  const docs = { products: false, raster: false, companion: false };
  const skipped = Object.fromEntries(
    jobs.map((job) => [job, { result: ['plan', 'source'].includes(job) ? 'success' : 'skipped' }]),
  );
  assert.doesNotThrow(() => assertResults(docs, skipped));
  assert.throws(() => assertResults(docs, { ...skipped, 'ui-tests': { result: 'success' } }));
});
