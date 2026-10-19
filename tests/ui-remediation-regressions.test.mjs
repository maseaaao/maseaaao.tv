import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

test('migration preserves Stream Info v4 action/event and existing persisted keys', () => {
  const client = read('apps/stream-info/src/composables/useStreamInfo.ts');
  const action = read('apps/stream-info/streamerbot/action.cs');
  assert.match(client, /const API_VERSION = 4/);
  assert.match(action, /private const int ApiVersion = 4/);
  for (const id of [
    'STREAM INFO | API',
    'stream_info_api_response',
    'change-info-streamer-bot.settings.v1',
    'change-info-streamer-bot.template-draft.v1',
  ])
    assert(client.includes(id), 'Missing persistent client identifier: ' + id);
  assert(action.includes('stream_info_api_response'));
});

test('historical baseline remains separate from the simplified site contract', () => {
  const baseline = JSON.parse(read('docs/ui-renewal-baseline.json'));
  assert(Array.isArray(baseline.files));
  assert(baseline.files.some((file) => file.path === 'dist/index.html'));
  const source = read('apps/website/src/components/HomePage.vue');
  assert(!source.includes('data-stream-layout'));
  assert(!source.includes('<iframe'));
  assert(read('apps/website/src/assets/check.js').includes('player.twitch.tv'));
});

test('published product names and OBS credential storage key are unchanged', () => {
  const settings = read('apps/obs-widgets/src/output-stats/main.js');
  const install = read('docs/local-installation.md');
  assert(settings.includes('easy-output-stats.credentials.v1'));
  assert(install.includes('change-info-streamer-bot.ru.html'));
  assert(install.includes('obs-tuna-widget.html') || read('README.md').includes('Tuna'));
});
