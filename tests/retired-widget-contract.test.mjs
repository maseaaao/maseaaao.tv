import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import widgetConfig from '../apps/obs-widgets/vite.config.mjs';

const root = resolve(import.meta.dirname, '..');
const retired = /output[- ]stats|OutputStats|outputStats|easy-output-stats|\/stats\.css/i;
const read = (name) => readFileSync(resolve(root, name), 'utf8');
function files(name) {
  return readdirSync(resolve(root, name), { withFileTypes: true }).flatMap((entry) => {
    const path = `${name}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('retired widget has no source, artifact or dedicated behavioral suite', () => {
  for (const name of [
    'apps/obs-widgets/src/output-stats',
    'apps/obs-widgets/dist/output-stats',
    'tests/obs-credentials.test.mjs',
    'tests/output-stats-acceptance.test.mjs',
  ])
    assert.equal(existsSync(resolve(root, name)), false, `${name} must remain retired`);
  for (const name of files('apps/obs-widgets/dist'))
    assert.doesNotMatch(name, retired, 'No retired delivery artifact');
});

test('active widget build, exports and installer do not reference the retired product', () => {
  const active = [
    'tooling/build-widgets.mjs',
    'tooling/sync-local.mjs',
    'apps/obs-widgets/vite.config.mjs',
    'apps/obs-widgets/package.json',
    ...files('apps/obs-widgets/src'),
  ];
  for (const name of active) {
    assert.doesNotMatch(name, retired, `${name}: no retired entrypoint`);
    if (/\.(?:mjs|js|ts|json|css|html)$/.test(name))
      assert.doesNotMatch(read(name), retired, `${name}: no retired reference`);
  }
});

test('standalone build rejects the retired entrypoint instead of silently redirecting it', async () => {
  await assert.rejects(widgetConfig({ mode: 'output-stats' }), /Unknown standalone widget/);
});
