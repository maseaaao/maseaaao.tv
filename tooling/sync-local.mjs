import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const value = (key) => args[args.indexOf(key) + 1];
const obs = resolve(args.includes('--obs-root') ? value('--obs-root') : resolve(repo, '..'));
if (!existsSync(resolve(obs, 'Streamer.bot/Streamer.bot.exe')))
  throw Error('Specify --obs-root pointing to the OBS folder containing Streamer.bot.');
const product = args.includes('--product') ? value('--product') : 'stream-info';
const groups = {
  'stream-info': [
    ['apps/stream-info/dist', 'Streamer.bot/custom/stream-info/dist'],
    [
      'apps/stream-info/streamerbot-import.txt',
      'Streamer.bot/custom/stream-info/streamerbot-import.txt',
    ],
  ],
  tuna: [['apps/tuna-widget/dist/obs-tuna-widget.html', 'obs-tuna-widget.html']],
  widgets: [
    ['apps/obs-widgets/dist/streamlabs-chat', 'streamlabs-chat'],
    ...['social-strip', 'donors', 'sounds'].map((name) => [
      `apps/obs-widgets/dist/${name}`,
      `Streamer.bot/custom/assets/${name}`,
    ]),
  ],
};
if (!(product in groups))
  throw Error(`Unknown product: ${product}. Choose ${Object.keys(groups).join(', ')}`);
const contained = (root, file) => {
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== file)
    throw Error('Path escapes its root');
};
const entries = [];
function rejectLinks(root, file) {
  for (let current = file; current !== root; current = dirname(current)) {
    contained(root, current);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error('Deployment cannot follow symbolic links or junctions');
  }
}
function collect(source, destination) {
  contained(repo, source);
  contained(obs, destination);
  rejectLinks(repo, source);
  rejectLinks(obs, destination);
  if (!existsSync(source)) throw Error(`Build the product first: ${relative(repo, source)}`);
  const list = readdirSync(dirname(source), { withFileTypes: true });
  if (list.find((item) => item.name === relative(dirname(source), source))?.isDirectory()) {
    for (const item of readdirSync(source, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw Error('Symbolic links cannot be deployed');
      if (item.name === 'review' || item.name.endsWith('-report.json')) continue;
      collect(resolve(source, item.name), resolve(destination, item.name));
    }
  } else entries.push({ source, destination });
}
for (const [source, target] of groups[product])
  collect(resolve(repo, source), resolve(obs, target));
for (const item of entries) item.content = readFileSync(item.source);
const hash = (content) => createHash('sha256').update(content).digest('hex');
const changed = entries.filter(
  (item) =>
    !existsSync(item.destination) || hash(item.content) !== hash(readFileSync(item.destination)),
);
const backup = resolve(
  obs,
  'Streamer.bot/backup',
  'monorepo-sync-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + product,
);
for (const { source, destination, content } of changed) {
  console.log(
    `${args.includes('--apply') ? 'COPY' : 'PLAN'} ${relative(repo, source)} -> ${relative(obs, destination)}`,
  );
  if (!args.includes('--apply')) continue;
  // Preserve every overwritten file before writing any new bytes to that path.
  if (existsSync(destination)) {
    const saved = resolve(backup, relative(obs, destination));
    contained(backup, saved);
    mkdirSync(dirname(saved), { recursive: true });
    copyFileSync(destination, saved);
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}
console.log(
  `${changed.length} files ${args.includes('--apply') ? 'updated' : 'would change'}. No Actions, databases or OBS settings are edited.`,
);
if (args.includes('--apply') && changed.length) console.log(`Backup: ${backup}`);
