import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

test('migration preserves Stream Info v4 action/event and existing persisted keys', () => {
  const client = read('apps/stream-info/src/controller.ts');
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
