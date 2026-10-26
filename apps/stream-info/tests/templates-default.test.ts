import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_TWITCH_TEMPLATE } from '../src/templates';

const TEMPLATE_RE = /DefaultTwitchTemplate = "([^"]+)"/;

it('uses the same Twitch template on first installation and client reset', () => {
  const source = readFileSync(new URL('../streamerbot/action.cs', import.meta.url), 'utf8');
  const match = source.match(TEMPLATE_RE);
  expect(match?.[1]).toBe(DEFAULT_TWITCH_TEMPLATE);
});
