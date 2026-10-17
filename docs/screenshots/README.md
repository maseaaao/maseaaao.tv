# Interface previews

Captured from the current source with Chromium 153 at 1440 px (desktop) and
390 px (mobile), with reduced motion and the current blue m avatar.

- `landing-desktop.png`: isolated offline state, chat manually collapsed.
- `landing-mobile.png`: cold narrow-page load; the embedded player is deliberately
  replaced by the existing external Twitch action below the minimum player width.

Twitch SDK and iframe networking are isolated. These are interface previews,
not evidence of an actual live broadcast or a working external media connection.

Run all site/OBS checks with `npm test`. Run `npm run browser:install` after `npm ci`, or set `CHROME_BIN` or
`CHROME_PATH` to an existing Chromium executable.
The suite includes Checker actions/TV layout, docs/check responsive and enlarged
text checks, banner/panel clipping, landing states/keyboard/contrast and OBS
transparency/geometry/QR/pixel parity.

To capture the landing matrix in a new directory, run:

```sh
CHROME_BIN=/path/to/chromium LANDING_AUDIT_OUT=/new/evidence-directory node --test --test-name-pattern='capture real Chromium' tests/landing-sync.test.mjs
```

The desktop preview comes from `offline-desktop-chat-closed.png`; the mobile
preview comes from `cold-mobile-390.png`. The capture also writes measurements
and isolated network conditions to `browser-evidence.json`.
