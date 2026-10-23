import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const workflow = parse(read('.github/workflows/verify.yml'));
const runs = (job) => workflow.jobs[job].steps.flatMap((step) => (step.run ? [step.run] : []));
const names = [
  'plan',
  'source',
  'products',
  'ui-tests',
  'repository-tests',
  'stream-info-tests',
  'raster',
  'companion',
];

test('the required aggregate owns every independently selected or product-dependent lane', () => {
  assert.deepEqual(workflow.jobs.verify.needs, names);
  assert.deepEqual(
    Object.keys(workflow.jobs).filter((job) => job !== 'verify'),
    names,
  );
  for (const [job, config] of Object.entries(workflow.jobs)) {
    assert.equal(config['continue-on-error'], undefined, job);
    for (const step of config.steps) assert.equal(step['continue-on-error'], undefined, job);
  }
  for (const job of ['source', 'ui-tests', 'repository-tests', 'stream-info-tests'])
    assert.equal(workflow.jobs[job].if, undefined, job);
  assert.equal(workflow.jobs.verify.if, 'always()');
  assert(runs('verify').includes('node tooling/ci-result.mjs'));
  assert.equal(workflow.jobs.source.needs, undefined, 'cheap source checks always run');
  for (const job of ['products', 'raster', 'companion']) {
    assert.deepEqual(workflow.jobs[job].needs, ['plan', 'source'], job);
    assert.equal(workflow.jobs[job].if, `needs.plan.outputs.${job} == 'true'`, job);
  }
  for (const job of ['ui-tests', 'stream-info-tests'])
    assert.equal(workflow.jobs[job].needs, 'products', job);
  assert.deepEqual(workflow.jobs['repository-tests'].needs, ['plan', 'products']);
  const mocks = workflow.jobs['repository-tests'].steps.find(
    (step) => step.run === 'bun run test:companion',
  );
  assert.equal(mocks.if, "matrix.shard == 1 && needs.plan.outputs.companion == 'false'");
  assert.deepEqual(workflow.jobs['repository-tests'].strategy, {
    'fail-fast': false,
    matrix: { shard: [1, 2, 3] },
  });
  for (const job of [...names, 'verify'])
    assert.equal(workflow.jobs[job]['runs-on'], 'ubuntu-latest', job);
});

test('task caches are lane-owned and saved immediately after successful task execution', () => {
  const action = parse(read('.github/actions/task-cache/action.yml'));
  const restore = action.runs.steps.find((step) => step.uses === 'actions/cache/restore@v4');
  const save = action.runs.steps.find((step) => step.uses === 'actions/cache/save@v4');
  assert(restore && save, 'restore/save must be explicit, not job-post cache');
  assert.equal(restore.with.path, '.build-cache/turbo');
  assert.equal(save.with.path, '.build-cache/turbo');
  assert.equal(restore.with.key, save.with.key);
  for (const token of [
    'runner.os',
    'runner.arch',
    '.node-version',
    '.bun-version',
    'bun.lock',
    'turbo.json',
    'tooling/run-tasks.mjs',
    'inputs.lane',
    'github.sha',
    'github.run_id',
    'github.run_attempt',
  ])
    assert(restore.with.key.includes(token), token);
  for (const prefix of restore.with['restore-keys'].trim().split('\n')) {
    assert(prefix.includes('inputs.lane'), 'never restore another task lane');
    for (const token of ['runner.os', 'runner.arch', '.node-version', '.bun-version', 'bun.lock'])
      assert(prefix.includes(token), token);
  }
  assert.equal(restore.if, "inputs.mode == 'restore'");
  assert.equal(save.if, "inputs.mode == 'save'");
  for (const [job, command] of [
    ['source', 'bun run check:source'],
    ['products', 'bun run verify:products'],
    ['raster', 'bun run build:all'],
  ]) {
    const steps = workflow.jobs[job].steps;
    const before = steps.findIndex(
      (step) => step.uses === './.github/actions/task-cache' && step.with.mode === 'restore',
    );
    const phase = steps.findIndex((step) => step.run === command);
    const after = steps.findIndex(
      (step) => step.uses === './.github/actions/task-cache' && step.with.mode === 'save',
    );
    assert(before >= 0 && before < phase, job);
    assert.equal(after, phase + 1, `${job}: save before later unrelated tests/checks`);
    for (const step of [steps[before], steps[after]]) {
      assert.equal(step.with.lane, job);
      assert.equal(step.if, undefined, 'default success gating must not save failed tasks');
    }
  }
  for (const job of [
    'plan',
    'ui-tests',
    'repository-tests',
    'stream-info-tests',
    'companion',
    'verify',
  ])
    assert(
      !workflow.jobs[job].steps.some((step) => step.uses === './.github/actions/task-cache'),
      job,
    );
  assert(
    !parse(read('.github/actions/setup/action.yml')).runs.steps.some(
      (step) => step.with?.path === '.build-cache/turbo',
    ),
  );
});

test('setup caches only Bun downloads with a single source writer after frozen installation', () => {
  const setup = parse(read('.github/actions/setup/action.yml'));
  assert.equal(setup.inputs?.['cache-write']?.default, 'false');
  const steps = setup.runs.steps;
  const restore = steps.findIndex((step) => step.uses === 'actions/cache/restore@v4');
  const install = steps.findIndex((step) => step.run === 'bun install --frozen-lockfile');
  const save = steps.findIndex((step) => step.uses === 'actions/cache/save@v4');
  assert(restore >= 0 && restore < install && save === install + 1);
  assert.equal(steps[restore].id, 'bun-cache');
  assert.equal(steps[restore].with.path, '~/.bun/install/cache');
  assert.equal(steps[save].with.path, '~/.bun/install/cache');
  assert.equal(steps[restore].with.key, steps[save].with.key);
  for (const token of ['runner.os', 'runner.arch', '.node-version', '.bun-version', 'bun.lock'])
    assert(steps[restore].with.key.includes(token), token);
  assert.equal(
    steps[save].if,
    "inputs.cache-write == 'true' && steps.bun-cache.outputs.cache-hit != 'true'",
  );
  for (const [job, config] of Object.entries(workflow.jobs)) {
    for (const step of config.steps.filter((entry) => entry.uses === './.github/actions/setup'))
      assert.equal(step.with?.['cache-write'], job === 'source' ? 'true' : undefined, job);
  }
  assert(
    !JSON.stringify(setup).includes('node_modules'),
    'isolated workspace links cannot be shared as an install cache',
  );
});

test('planning needs pinned Node and full Git history, never dependency installation or task caches', () => {
  const steps = workflow.jobs.plan.steps;
  assert.equal(steps.find((step) => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0);
  assert.equal(
    steps.find((step) => step.uses === 'actions/setup-node@v4').with['node-version-file'],
    '.node-version',
  );
  assert(!steps.some((step) => step.uses?.startsWith('./.github/actions/')));
  assert.deepEqual(runs('plan'), ['node tooling/affected.mjs']);
  const selection = steps.find((step) => step.id === 'select');
  assert.equal(
    selection.env.BASE_SHA,
    `\${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event_name == 'push' && github.event.before || '' }}`,
  );
});

const productPaths = [
  'dist',
  'apps/stream-info/dist',
  'apps/tuna-widget/dist',
  'apps/obs-widgets/dist',
  'apps/stream-info/streamerbot-import.txt',
  '.build-cache/artwork',
  '.build-cache/storybook',
  '.build-cache/ui-portability',
  '.build-cache/static-fixtures',
];
const consumers = ['ui-tests', 'repository-tests', 'stream-info-tests'];
const shell = (script, cwd, cache) =>
  spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd,
    env: { ...process.env, RUNNER_TEMP: cache },
    encoding: 'utf8',
  });

test('product transfer is required, complete and restores exact bytes without stale checkout outputs', () => {
  const productSteps = workflow.jobs.products.steps;
  const archive = productSteps.find((step) => step.id === 'archive');
  const upload = productSteps.find(
    (step) => step.uses === 'actions/upload-artifact@v4' && step.with.name === 'ci-products',
  );
  assert(archive && upload);
  assert(
    productSteps.findIndex((step) => step.run === 'bun run check:artifacts') <
      productSteps.indexOf(archive),
  );
  assert(productSteps.indexOf(archive) < productSteps.indexOf(upload));
  assert.equal(upload.with.path, `\${{ runner.temp }}/ci-products.tar`);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], 3);
  assert.equal(upload.if, undefined, 'test transfer must not publish failed builds');
  const directory = mkdtempSync(join(tmpdir(), 'ci-transfer-'));
  try {
    const producer = join(directory, 'producer');
    mkdirSync(producer);
    for (const path of productPaths) {
      const target = join(producer, path);
      if (path.endsWith('.txt')) {
        mkdirSync(resolve(target, '..'), { recursive: true });
        writeFileSync(target, 'generated import');
      } else {
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, 'current.bin'), Buffer.from([0, 255, 13, 10, 42]));
      }
    }
    mkdirSync(join(producer, 'dist/.well-known'));
    writeFileSync(join(producer, 'dist/.well-known/api-catalog'), 'hidden publication');
    const built = shell(archive.run, producer, directory);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const listing = execFileSync('tar', ['-tf', join(directory, 'ci-products.tar')], {
      encoding: 'utf8',
    });
    for (const path of productPaths) assert(listing.includes(path), path);
    assert(listing.includes('dist/.well-known/api-catalog'));
    for (const job of consumers) {
      const steps = workflow.jobs[job].steps;
      const download = steps.find((step) => step.uses === 'actions/download-artifact@v4');
      const restore = steps.find((step) => step.id === 'restore-products');
      assert.equal(download.with.name, 'ci-products', job);
      assert.equal(download.with.path, `\${{ runner.temp }}`, job);
      assert.equal(download['continue-on-error'], undefined);
      assert(steps.indexOf(download) < steps.indexOf(restore));
      const target = join(directory, job);
      mkdirSync(target);
      for (const path of productPaths.filter((entry) => !entry.endsWith('.txt'))) {
        mkdirSync(join(target, path), { recursive: true });
        writeFileSync(join(target, path, 'stale-chunk.js'), 'stale checkout output');
      }
      const restored = shell(restore.run, target, directory);
      assert.equal(restored.status, 0, restored.stdout + restored.stderr);
      for (const path of productPaths) {
        const file = path.endsWith('.txt') ? path : join(path, 'current.bin');
        assert(
          readFileSync(join(target, file)).equals(readFileSync(join(producer, file))),
          `${job}: ${file}`,
        );
        assert(!existsSync(join(target, path, 'stale-chunk.js')), `${job}: stale ${path}`);
      }
      assert.equal(
        readFileSync(join(target, 'dist/.well-known/api-catalog'), 'utf8'),
        'hidden publication',
      );
      assert(statSync(join(target, 'dist/.well-known')).mode & 0o100);
    }
    rmSync(join(producer, '.build-cache/static-fixtures'), { recursive: true });
    assert.notEqual(
      shell(archive.run, producer, directory).status,
      0,
      'an incomplete output set must fail archive creation',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('missing or corrupt transfer fails before deleting checkout outputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-transfer-failure-'));
  try {
    const cache = join(directory, 'downloads');
    mkdirSync(cache);
    mkdirSync(join(directory, 'dist'));
    const sentinel = join(directory, 'dist/unchanged.txt');
    for (const job of consumers) {
      const restore = workflow.jobs[job].steps.find((step) => step.id === 'restore-products');
      for (const corrupt of [false, true]) {
        rmSync(join(cache, 'ci-products.tar'), { force: true });
        if (corrupt) writeFileSync(join(cache, 'ci-products.tar'), 'not a tar archive');
        writeFileSync(sentinel, 'leave existing outputs alone');
        const result = shell(restore.run, directory, cache);
        assert.notEqual(result.status, 0, job);
        assert(existsSync(sentinel), `${job}: validate archive before output cleanup`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all jobs have bounded execution and checkout credentials are not persisted', () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0, name);
    for (const checkout of job.steps.filter((step) => step.uses === 'actions/checkout@v4'))
      assert.equal(checkout.with?.['persist-credentials'], false, name);
  }
  assert(runs('source').some((command) => command.includes('tests/ci-tests.test.mjs')));
});

test('.NET setup is limited to jobs compiling C# rather than browser contract shards', () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(
      job.steps.some((step) => step.uses === 'actions/setup-dotnet@v4'),
      ['companion', 'stream-info-tests'].includes(name),
      name,
    );
  }
});
