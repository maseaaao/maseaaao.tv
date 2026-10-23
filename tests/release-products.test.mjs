import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'tooling/release-products.json'), 'utf8'));
const expression = (body) => `$${'{{'} ${body} }}`;
const workflow = parse(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8'));

test('the release manifest declares the products that get independent releases', () => {
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
    assert.match(product.tagPrefix, new RegExp(`^${product.id}-v$`));
    assert.ok(product.files.length > 0, product.id);
    for (const mapping of product.files) {
      assert.equal(typeof mapping.source, 'string');
      assert.equal(typeof mapping.target, 'string');
    }
    assert.ok(product.test && product.build, product.id);
    assert.equal(typeof product.browser, 'boolean');
    assert.ok(product.activation);
  }
});

test('artwork releases render final images and Stream Info includes its import', () => {
  assert.equal(manifest.products.find((p) => p.id === 'artwork').build, 'bun run verify:artwork');
  assert.ok(
    manifest.products
      .find((p) => p.id === 'stream-info')
      .files.some((f) => f.target === 'streamerbot-import.txt'),
  );
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

test('release requirements explicitly limit SDK, browser and font setup', () => {
  for (const product of manifest.products)
    assert.equal(typeof product.dotnet, 'boolean', product.id);
  assert.deepEqual(
    manifest.products.filter((p) => p.dotnet).map((p) => p.id),
    ['stream-info', 'system-microphone', 'voice-stream'],
  );
  assert.deepEqual(
    manifest.products.filter((p) => p.browser).map((p) => p.id),
    ['tuna-widget', 'artwork'],
  );
  assert.deepEqual(
    manifest.products.filter((p) => p.pythonRequirements).map((p) => p.id),
    ['artwork'],
  );
});

test('release workflow separates pure plan, unprivileged pinned build and privileged draft', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['plan', 'build', 'draft']);
  const { plan, build, draft } = workflow.jobs;
  assert.equal(
    plan.steps.some((step) => step.uses === './.github/actions/setup'),
    false,
  );
  assert.equal(
    plan.steps.find((step) => step.uses?.startsWith('actions/checkout')).with.ref,
    `refs/tags/${expression('inputs.tag || github.ref_name')}`,
  );
  assert.ok(plan.steps.some((step) => step.run?.includes('--plan "$RELEASE_TAG"')));
  assert.equal(build.needs, 'plan');
  assert.deepEqual(draft.needs, ['plan', 'build']);
  assert.deepEqual(draft.permissions, { contents: 'write' });
  for (const job of [plan, build, draft]) {
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout'));
    assert.equal(checkout.with['persist-credentials'], false);
  }
  for (const job of [build, draft]) {
    assert.equal(
      job.steps.find((step) => step.uses?.startsWith('actions/checkout')).with.ref,
      expression('needs.plan.outputs.sha'),
    );
  }
  assert.equal(
    build.steps.find((step) => step.uses?.startsWith('actions/setup-dotnet')).if,
    "needs.plan.outputs.dotnet == 'true'",
  );
  assert.equal(
    build.steps.find((step) => step.run?.includes('browser:install')).if,
    "needs.plan.outputs.browser == 'true'",
  );
  assert.equal(
    build.steps.find((step) => step.run?.includes('pip install')).if,
    "needs.plan.outputs.pythonRequirements != ''",
  );
  const upload = build.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'));
  const download = draft.steps.find((step) => step.uses?.startsWith('actions/download-artifact'));
  assert.equal(upload.with.name, download.with.name);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['include-hidden-files'], true);
  assert.equal(download.with['run-id'], undefined, 'only the current run is accepted');
  assert.equal(download.with['github-token'], undefined);
  assert.ok(build.steps.some((step) => step.run?.includes('bun run test:releases')));
  assert.ok(build.steps.some((step) => step.run?.includes('tests/release-pipeline.test.mjs')));
  for (const job of [plan, build])
    assert.doesNotMatch(JSON.stringify(job), /GH_TOKEN|github\.token|secrets\./);
  assert.equal(workflow.env.GH_TOKEN, undefined);
  assert.equal(draft.env.GH_TOKEN, undefined);
  assert.equal(
    draft.steps.some((step) => step.uses === './.github/actions/setup'),
    false,
  );
  const validation = draft.steps.findIndex((step) => step.run?.includes('--verify-package'));
  const remote = draft.steps.findIndex((step) => step.run?.includes('--draft'));
  assert.ok(
    validation >= 0 && validation < remote,
    'validate transferred archives before exposing token',
  );
  assert.equal(draft.steps[remote].env.GH_TOKEN, expression('github.token'));
});

test('publication requires an explicit manual opt-in after verified draft creation', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  const promote = workflow.jobs.draft.steps.find((step) => step.run?.includes('--promote'));
  assert.equal(promote.if, "github.event_name == 'workflow_dispatch' && inputs.publish == true");
  assert.equal(promote.env.GH_TOKEN, expression('github.token'));
});
