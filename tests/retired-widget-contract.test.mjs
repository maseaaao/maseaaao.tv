import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import widgetConfig from '../apps/obs-widgets/vite.config.mjs';

const root = resolve(import.meta.dirname, '..');
test('widget delivery contains only supported products and rejects the retired mode', async () => {
  assert.deepEqual(readdirSync(resolve(root, 'apps/obs-widgets/dist')).sort(), [
    'donors',
    'social-strip',
    'streamlabs-chat',
  ]);
  await assert.rejects(widgetConfig({ mode: 'output-stats' }), /Unknown standalone widget/);
});
