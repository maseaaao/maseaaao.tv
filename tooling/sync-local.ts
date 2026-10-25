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
import { parseArgs } from 'node:util';

const repo = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    apply: { default: false, type: 'boolean' },
    'obs-root': { type: 'string' },
    product: { default: 'stream-info', type: 'string' },
  },
});
const obs = resolve(values['obs-root'] ?? resolve(repo, '..'));
if (!existsSync(resolve(obs, 'Streamer.bot/Streamer.bot.exe'))) {
  throw new Error('Specify --obs-root pointing to the OBS folder containing Streamer.bot.');
}
const { product } = values;
const groups: Record<string, string[][]> = {
  'stream-info': [
    ['dist/stream-info', 'Streamer.bot/custom/stream-info/dist'],
    [
      'dist/stream-info/streamerbot-import.txt',
      'Streamer.bot/custom/stream-info/streamerbot-import.txt',
    ],
  ],
  tuna: [['dist/tuna-widget/obs-tuna-widget.html', 'obs-tuna-widget.html']],
  widgets: [
    ['dist/obs-widgets/streamlabs-chat', 'streamlabs-chat'],
    ...['social-strip', 'donors'].map((name) => [
      `dist/obs-widgets/${name}`,
      `Streamer.bot/custom/assets/${name}`,
    ]),
  ],
};
if (!(product in groups)) {
  throw new Error(`Unknown product: ${product}. Choose ${Object.keys(groups).join(', ')}`);
}
const contained = (root: string, file: string) => {
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== file) {
    throw new Error('Path escapes its root');
  }
};
const entries: { source: string; destination: string }[] = [];
function rejectLinks(root: string, file: string) {
  for (let current = file; current !== root; current = dirname(current)) {
    contained(root, current);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('Deployment cannot follow symbolic links or junctions');
    }
  }
}
function collect(source: string, destination: string) {
  contained(repo, source);
  contained(obs, destination);
  rejectLinks(repo, source);
  rejectLinks(obs, destination);
  if (!existsSync(source)) {
    throw new Error(`Build the product first: ${relative(repo, source)}`);
  }
  const list = readdirSync(dirname(source), { withFileTypes: true });
  if (list.find((item) => item.name === relative(dirname(source), source))?.isDirectory()) {
    for (const item of readdirSync(source, { withFileTypes: true })) {
      if (item.isSymbolicLink()) {
        throw new Error('Symbolic links cannot be deployed');
      }
      if (item.name === 'review' || item.name.endsWith('-report.json')) {
        continue;
      }
      collect(resolve(source, item.name), resolve(destination, item.name));
    }
  } else {
    entries.push({ destination, source });
  }
}
for (const [source, target] of groups[product]) {
  collect(resolve(repo, source), resolve(obs, target));
}
const loaded = entries.map((item) => ({ ...item, content: readFileSync(item.source) }));
const hash = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');
const changed = loaded.filter(
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
    `${values.apply ? 'COPY' : 'PLAN'} ${relative(repo, source)} -> ${relative(obs, destination)}`,
  );
  if (!values.apply) {
    continue;
  }
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
  `${changed.length} files ${values.apply ? 'updated' : 'would change'}. No Actions, databases or OBS settings are edited.`,
);
if (values.apply && changed.length) {
  console.log(`Backup: ${backup}`);
}
