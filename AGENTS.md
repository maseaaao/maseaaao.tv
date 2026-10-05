# Instructions for AI coding agents

## Project

This repository contains the Russian-language maseaaao.tv streaming link hub and
brand assets for OBS, Twitch, and YouTube. Preserve the existing dark visual
identity, approved logo, and local Inter / Unbounded fonts.

## Structure

- `dist/` is the **hand-authored, deployable website**, despite its name. Edit
  `dist/index.html` and `dist/assets/site.css` directly for landing-page changes.
- `dist/assets/brand.css` contains shared brand tokens and local font declarations.
  Prefer landing-specific changes in `site.css` when other brand surfaces should
  stay unchanged.
- `src/` contains source templates and assets for logos, banners, scenes,
  Twitch description panels, and wallpapers. `rendered/` directories contain
  generated output; change the source first when updating those assets.
- `scripts/` contains Node.js asset generation and rendering utilities.
- `wrangler.jsonc` configures Cloudflare static assets from `./dist`.

## Editing rules

- Keep the static HTML/CSS architecture. Do not add a framework, UI library,
  runtime JavaScript, or dependencies for simple landing changes.
- Keep npm and `package-lock.json`; install dependencies with `npm ci`.
- Keep copy in Russian and preserve link destinations unless asked to change them.
  Verify new profile URLs against an owner-provided source or public profile;
  do not guess handles silently.
- Preserve canonical URL, social metadata, favicon, and approved images unless
  relevant to the request. Update descriptions when listed platforms change.
- Use semantic links, meaningful labels, `aria-hidden` on decorative icons,
  visible keyboard focus, and `noopener noreferrer` on links opening new tabs.
- Check mobile layouts, long text, keyboard access, contrast, and reduced motion.
- Avoid unrelated formatting churn, asset regeneration, or speculative features.
- Never commit credentials, `node_modules`, or temporary verification artifacts.

## Verification

There is currently no landing build, lint, or test script. Do not invent one or
run asset generators as a substitute for checking the landing page.

For HTML/CSS edits:

1. Serve `dist`, for example with `python3 -m http.server 8000 --directory dist`.
2. Inspect the page in a browser on desktop and at widths of 320, 390, and 540 px.
   Check loaded fonts/images, horizontal overflow, link order, and button states.
3. Verify link destinations and metadata, and run `git diff --check`.
4. Report what was actually checked and any verification limitations.

For generated assets, run only the relevant command from `package.json`:
`render:youtube-banner`, `render:twitch-banner`, `render:logo`, `render:scenes`,
`render:twitch-description`, `brand:assets`, or `brand:subscribe`. Browser-based
renderers use a Chrome/Chromium executable; `scripts/render-scenes.mjs` supports
`CHROME_BIN`. Inspect the generated output and diff before committing it.
`npm run full` and `optimize:images` can rewrite multiple assets; use them only
when the requested scope requires that work.

## Delivery

For a PR request, use a feature branch and open a PR against `main` with a concise
description of the final behavior and validation. Do not merge or deploy unless
the user asks. Communicate with the owner in Russian.
