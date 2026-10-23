import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const workflow = parse(read('.github/workflows/verify.yml'));
const commands = (job) => workflow.jobs[job].steps.flatMap((step) => (step.run ? [step.run] : []));
test('acceptance renders before website builds and checks source exactly once', () => {
  assert.deepEqual(pkg.scripts['verify:artwork'].split(' && '), [
    'bun run build:fonts',
    'bun run render:logo',
    'bun run build:artwork',
    'bun run render:scenes --prepared',
    'bun run render:cyber-site all --prepared',
  ]);
  const steps = pkg.scripts['verify:ui-renewal'].split(' && ');
  assert.deepEqual(steps, [
    'bun run check:source',
    'bun run verify:artwork',
    'bun run verify:products',
    'bun run check:repository',
    'bun run test:ui',
    'bun run test:ui-probe',
    'bun run test:static',
    'bun run test:checks',
    'bun run check:artifacts',
    'git diff --check',
  ]);
  assert.match(pkg.scripts['verify:products'], /run-tasks\.mjs build/);
  assert.match(pkg.scripts['verify:products'], /--filter=\.\/apps\/\*/);
  assert.match(pkg.scripts['verify:products'], /--filter=\.\/tooling\/\*/);
});
test('raster retains pinned Linux, Python and exact artifact verification after rebuilding website', () => {
  const job = workflow.jobs.raster;
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert(
    job.steps.some(
      (step) => step.uses === 'actions/setup-python@v5' && step.with['python-version'] === '3.12',
    ),
  );
  const runs = commands('raster');
  assert(runs.includes('python -m pip install -r tooling/artwork/requirements-fonts.txt'));
  assert(runs.indexOf('bun run verify:artwork') < runs.indexOf('bun run build:all'));
  assert(runs.indexOf('bun run build:all') < runs.indexOf('bun run check:artifacts'));
  assert.equal(
    pkg.scripts['build:fonts'],
    'node tooling/run-python.mjs tooling/artwork/build-web-fonts.py',
  );
  const source = read('tooling/check-generated-artifacts.mjs');
  assert.match(source, /'artwork\/scenes\/rendered'/);
  assert.match(source, /artifacts\.sha256/);
  assert.match(source, /'--untracked-files=all'/);
});
test('the raster job publishes the re-rendered baseline for review', () => {
  const job = workflow.jobs.raster;
  const upload = job.steps.find((step) => step.uses === 'actions/upload-artifact@v4');
  assert(upload, 'the raster job must publish the rendered baseline');
  assert(upload.with.name === 'website-and-artwork-preview');
  assert.match(upload.with.path, /artwork\/scenes\/rendered/);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with['include-hidden-files'], true);
  assert.equal(upload.with['retention-days'], 7);
  assert.match(upload.with.path, /\.build-cache\/verify\/artifacts\.sha256/);
  assert.equal(pkg.scripts['accept:artifacts'], 'node tooling/accept-artifacts.mjs');
  // The acceptance tool may remove a file the build no longer produces, but
  // only when the canonical runner reports it as missing. The behaviour is
  // covered by tests/accept-artifacts.test.mjs.
  assert.doesNotMatch(read('tooling/accept-artifacts.mjs'), /rm -rf|execFileSync\('rm'/);
});

test('the published baseline covers every tracked artifact', () => {
  // The acceptance tool resolves files by name, so a published path that misses
  // a tracked artifact would make the baseline incomplete and unreviewable.
  const upload = workflow.jobs.raster.steps.find(
    (step) => step.uses === 'actions/upload-artifact@v4',
  );
  const published = upload.with.path
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const required = [
    'dist/**',
    'apps/stream-info/dist/**',
    'apps/stream-info/streamerbot-import.txt',
    'apps/tuna-widget/dist/**',
    'apps/obs-widgets/dist/**',
    'artwork/scenes/rendered/**',
    'artwork/banners/rendered/**',
    'artwork/twitch-description/rendered/**',
    'artwork/brand/rendered/website/**',
    'artwork/logo/rendered/**',
    'artwork/wallpapers/rendered/**',
  ];
  for (const path of required) {
    assert(
      published.includes(path),
      `the published baseline must include ${path} so the whole set can be accepted`,
    );
  }
});
test('the product outputs are compared byte for byte in the products job', () => {
  // Raster keeps a complete acceptance bundle, but product-only selections
  // must compare their rebuilt standalone outputs even when raster is skipped.
  assert(commands('products').includes('bun run check:artifacts'));
  assert(commands('raster').includes('bun run check:artifacts'));
});

test('the published text assets keep LF on every operating system', () => {
  // The published files are copied verbatim into dist/. Without a fixed EOL a
  // Windows checkout produces CRLF and the byte comparison fails there.
  const attributes = read('.gitattributes');
  for (const path of [
    'apps/website/public/_headers',
    'apps/website/public/sitemap.xml',
    'apps/website/public/.well-known/api-catalog',
  ]) {
    assert.match(attributes, new RegExp(`${path.replace(/[/.]/g, '\\$&')} text eol=lf`));
  }
});

test('all CI jobs run on Linux', () => {
  for (const job of [
    'plan',
    'source',
    'products',
    'ui-tests',
    'repository-tests',
    'stream-info-tests',
    'raster',
    'companion',
    'verify',
  ])
    assert.equal(workflow.jobs[job]['runs-on'], 'ubuntu-latest', job);
  // Browser rendering on Linux needs the system libraries of the runner.
  for (const job of ['ui-tests', 'repository-tests', 'raster'])
    assert(
      commands(job).some((command) => command.includes('browser:install --with-deps')),
      job,
    );
});
test('split CI preserves all test groups and fails closed at its required aggregate', () => {
  for (const command of ['verify:products', 'check:repository'])
    assert(commands('products').includes(`bun run ${command}`), command);
  for (const command of ['test:ui', 'test:ui-probe', 'test:static'])
    assert(commands('ui-tests').includes(`bun run ${command}`), command);
  assert(commands('stream-info-tests').includes('bun run test:stream-info'));
  assert(commands('source').includes('bun run test:local'));
  assert(
    commands('repository-tests').some((command) =>
      command.includes('node tooling/ci-tests.mjs --shard'),
    ),
  );
  assert(commands('repository-tests').includes('bun run test:companion'));
  // test:checks is decomposed, not discarded: root contracts, Stream Info
  // Vitest+C#, Companion mocks and local contracts each retain an owner.
  assert(commands('source').includes('bun run check:source'));
  assert(!commands('products').includes('bun run check:source'));
  assert(commands('companion').includes('node --test tests/companion-build.test.mjs'));
  assert(commands('companion').includes('python integrations/companion/shared/test-packages.py'));
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert(workflow.on.schedule.length);
  assert.equal(workflow.jobs.verify.if, 'always()');
  assert.deepEqual(workflow.jobs.verify.needs, [
    'plan',
    'source',
    'products',
    'ui-tests',
    'repository-tests',
    'stream-info-tests',
    'raster',
    'companion',
  ]);
  assert(commands('verify').includes('node tooling/ci-result.mjs'));
  assert.match(read('.github/actions/setup/action.yml'), /bun install --frozen-lockfile/);
});
