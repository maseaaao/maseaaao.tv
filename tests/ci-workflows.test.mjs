import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const workflow = parse(read('.github/workflows/verify.yml'));
const pkg = JSON.parse(read('package.json'));

test('one Linux verification job runs every product check without selection or transfers', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['verify']);
  const job = workflow.jobs.verify;
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert(Number.isInteger(job['timeout-minutes']));
  assert.equal(job.if, undefined);
  const runs = job.steps.flatMap((step) => (step.run ? [step.run] : []));
  for (const command of [
    'bun run verify:ui-renewal',
    'bun run test:releases',
    'bun run verify:companion',
  ])
    assert(runs.includes(command), command);
  for (const step of job.steps) {
    assert.equal(step['continue-on-error'], undefined);
    assert.equal(step.if, undefined);
    if (step.uses === 'actions/checkout@v4') assert.equal(step.with['persist-credentials'], false);
  }
  assert.doesNotMatch(
    JSON.stringify(workflow),
    /affected|ci-result|ci-tests|task-cache|download-artifact|upload-artifact|matrix/,
  );
});

test('ordinary build commands cover every product build and test group', () => {
  assert.equal(pkg.devDependencies.turbo, undefined);
  assert.equal(pkg.scripts['verify:products'], 'bun run build:all');
  assert.equal(
    pkg.scripts['build:all'],
    'bun run build:website && bun run build:stream-info && bun run build:tuna && bun run build:widgets && bun run build:artwork',
  );
  assert.equal(
    pkg.scripts['test:checks'],
    'bun run test:repository && bun run test:stream-info && bun run test:companion && bun run test:local',
  );
});

test('CI uses the matching prebuilt Playwright image without browser installation', () => {
  const release = parse(read('.github/workflows/release.yml'));
  for (const job of [workflow.jobs.verify, release.jobs.release]) {
    assert.equal(
      job.container.image,
      `mcr.microsoft.com/playwright:v${pkg.devDependencies['playwright-core']}-noble`,
    );
    assert.equal(job.container.options, '--init --ipc=host');
    assert.equal(job.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
    assert.equal(job.defaults.run.shell, 'bash');
    assert.doesNotMatch(
      JSON.stringify(job.steps),
      /browser:install|playwright.* install|requirements-fonts/,
    );
  }
});
