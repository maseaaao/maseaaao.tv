# Interface previews

Current previews use Chromium 153 with local fonts and the approved blue avatar.
The wide desktop layout places profile/player/chat on the left and links on the
right. Desktop player and chat remain visible even when the channel is offline.

- `landing-desktop.png`, `landing-light-1440.png`, `landing-dark-1440.png`: offline
  desktop with the player and chat open by default.
- `landing-online-{light,dark}-1440.png`: online desktop with the same geometry.
- `landing-mobile.png`, `landing-light-390.png`, `landing-dark-390.png`: compact
  layout; below Twitch's minimum player width, the external action remains.
- `theme-menu-{light,dark}-{width}.png`: expanded theme menu at 1440px and 320px.

All Twitch SDK/iframe networking is isolated. Placeholder text in the player and
chat identifies the test responses. These images establish layout behavior, not
real Twitch connectivity or playback.

Run site/OBS regression checks with `npm test`. After `npm ci`, install Chromium
with `npm run browser:install`, or set `CHROME_BIN` / `CHROME_PATH` to an existing
browser. See `../layout.md` for responsive/media behavior and `../themes.md` for
palette, contrast and theme controls.

For a fresh state/viewport evidence directory:

```sh
CHROME_BIN=/path/to/chromium LANDING_AUDIT_OUT=/new/evidence-directory node --test --test-name-pattern='capture real Chromium' tests/landing-sync.test.mjs
```

That optional audit also captures a manually collapsed desktop chat to verify
that user choice still works; it is not the default layout.
