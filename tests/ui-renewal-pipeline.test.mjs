import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const tokens = (script) => pkg.scripts[script].split(' && ');
test('acceptance builds artwork before standalone products, then verifies generated hashes', () => {
  assert.deepEqual(tokens('verify:artwork'), [
    'npm run build:fonts',
    'npm run render:logo',
    'npm run build:artwork',
    'npm run render:scenes -- --prepared',
    'npm run render:cyber-site -- all --prepared',
  ]);
  assert.deepEqual(tokens('verify:products'), [
    'npm run build:ui',
    'npm run build:tuna',
    'npm run build:stream-info',
    'npm run build:widgets',
    'npm run build:website',
  ]);
  assert.deepEqual(tokens('verify:ui-renewal'), [
    'npm run check:source',
    'npm run verify:artwork',
    'npm run verify:products',
    'npm run check',
    'npm run test:ui',
    'npm run test:ui-probe',
    'npm run test:static',
    'npm run test:checks',
    'npm run check:artifacts',
    'git diff --check',
  ]);
});
test('CI uses the same acceptance script before artifact upload', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/verify.yml'), 'utf8');
  assert.match(workflow, /run: npm run verify:ui-renewal/);
  const windowsJob = workflow.split('  companion-build:')[1];
  assert.ok(windowsJob, 'Windows build job is present');
  assert.match(
    windowsJob,
    /run: node --test tests\/companion-libs-preparation\.test\.mjs/,
    'Windows-only preparation regressions must execute in the Windows job',
  );
  const source = readFileSync(resolve(root, 'tooling/check-generated-artifacts.mjs'), 'utf8');
  assert.match(source, /'artwork\/scenes\/rendered'/);
  assert.match(source, /artifacts\.sha256/);
  assert.match(source, /'--untracked-files=all'/);
});
