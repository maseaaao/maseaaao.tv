import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_TWITCH_TEMPLATE, DEFAULT_YOUTUBE_TEMPLATE } from '../src/templates';

const TWITCH_TEMPLATE_RE = /DefaultTwitchTemplate = "([^"]+)"/;
const YOUTUBE_TEMPLATE_RE = /DefaultYouTubeTemplate = "([^"]+)"/;

it('uses the same platform templates on first installation and client reset', () => {
  const source = readFileSync(new URL('../streamerbot/action.cs', import.meta.url), 'utf8');
  expect(source.match(TWITCH_TEMPLATE_RE)?.[1]).toBe(DEFAULT_TWITCH_TEMPLATE);
  expect(source.match(YOUTUBE_TEMPLATE_RE)?.[1]).toBe(DEFAULT_YOUTUBE_TEMPLATE);
});
