import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareObsChatCss } from '../tooling/local/obs-provider-css.mjs';

test('OBS chat override embeds the generated skin while retaining the installed size and provider lifecycle', () => {
  const source = readFileSync(
    new URL('../apps/obs-widgets/dist/streamlabs-chat/chat-box.css', import.meta.url),
    'utf8',
  );
  const css = prepareObsChatCss(source, 'body { font-size: 36px; }');
  assert.match(css, /font-size:\s*36px/);
  assert.match(css, /data:font\/woff2;base64,/);
  assert.match(css, /SIL OPEN FONT LICENSE/);
  assert.doesNotMatch(css, /\{font_size\}|\{message_hide_delay\}|var\(--provider-/);
  assert.doesNotMatch(css, /animation(?:-[a-z-]+)?\s*:|@(?:-webkit-)?keyframes/);
  assert.match(source, /\{message_hide_delay\}/, 'The provider distribution remains a template');
});

test('OBS adapter refuses to guess an absent or relative provider font size', () => {
  for (const installed of ['', 'body { font-size: 2em; }', '.message { font-size: 36px; }'])
    assert.throws(
      () => prepareObsChatCss('body { font-size: {font_size}; }', installed),
      /Verify the existing/,
    );
});
