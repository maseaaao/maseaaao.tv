import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Accept a rendered artifact baseline produced by another operating system.
//
// The raster baseline is bound to one OS: Chromium rasterizes text differently
// on Windows and Linux, so the committed bytes only reproduce inside the
// canonical runner. After the baseline is re-rendered, the CI artifact
// "website-and-artwork-preview" carries the new files. This script copies
// them over the tracked paths so the change can be reviewed and committed.
//
// The whole set is resolved before anything is written: a partial baseline must
// not leave the tree half updated.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.argv[2] ?? '');
if (!existsSync(source)) {
  throw new Error('Usage: node tooling/accept-artifacts.mjs <extracted artifact directory>');
}

const targets = [
  'dist',
  'apps/stream-info/dist',
  'apps/stream-info/streamerbot-import.txt',
  'apps/tuna-widget/dist',
  'apps/obs-widgets/dist',
  'artwork/scenes/rendered',
  'artwork/banners/rendered',
  'artwork/twitch-description/rendered',
  'artwork/brand/rendered/website',
  'artwork/logo/rendered',
  'artwork/wallpapers/rendered',
];

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const tracked = git('ls-files', '--', ...targets)
  .split('\n')
  .filter(Boolean);

const byName = new Map();
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (!byName.has(entry.name)) byName.set(entry.name, path);
  }
};
walk(source);

function resolveSource(relativePath) {
  const direct = join(source, relativePath);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  return byName.get(relativePath.split('/').pop()) ?? null;
}

const plan = [];
const missing = [];
for (const file of tracked) {
  const from = resolveSource(file);
  if (!from) {
    missing.push(file);
    continue;
  }
  const target = resolve(root, file);
  const next = readFileSync(from);
  if (existsSync(target) && readFileSync(target).equals(next)) continue;
  plan.push({ file, from, target });
}
if (missing.length)
  throw new Error(
    `Artifact is missing ${missing.length} tracked file(s): ${missing.slice(0, 5).join(', ')}`,
  );

let copied = 0;
for (const { file, from, target } of plan) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(from, target);
  copied++;
  console.log(`updated ${file}`);
}
console.log(`Accepted raster baseline: ${copied} updated.`);
console.log('Review the diff and commit it; the canonical runner must match this OS.');
