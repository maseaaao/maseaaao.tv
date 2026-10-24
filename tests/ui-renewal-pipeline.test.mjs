import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const workflow = parse(read('.github/workflows/verify.yml'));
test('acceptance renders before builds and retains every product test', () => {
  assert.deepEqual(pkg.scripts['verify:artwork'].split(' && '), [
    'bun run render:logo',
    'bun run build:artwork',
    'bun run render:scenes --prepared',
    'bun run render:cyber-site all --prepared',
  ]);
  assert.deepEqual(pkg.scripts['verify:ui-renewal'].split(' && '), [
    'bun run check:source',
    'bun run verify:artwork',
    'bun run verify:products',
    'bun run check:repository',
    'bun run test:checks',
    'bun run check:artifacts',
    'git diff --check',
  ]);
  const steps = workflow.jobs.verify.steps;
  assert(steps.some((step) => step.run === 'bun run verify:ui-renewal'));
  assert(!steps.some((step) => /browser:install|requirements-fonts/.test(step.run || '')));
  const source = read('tooling/check-generated-artifacts.mjs');
  assert.match(source, /'artwork\/scenes\/rendered'/);
  assert.match(source, /'--untracked-files=all'/);
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
