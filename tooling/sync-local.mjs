import {existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync, lstatSync} from 'node:fs';
import {resolve, relative, sep, dirname} from 'node:path';
import {createHash} from 'node:crypto';

const repo = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
const obs = resolve(args.includes('--obs-root') ? value('--obs-root') : resolve(repo, '..'));
if (!existsSync(resolve(obs, 'Streamer.bot/Streamer.bot.exe'))) throw Error('Specify --obs-root pointing to the OBS folder containing Streamer.bot.');
const product = args.includes('--product') ? value('--product') : 'stream-info';
const groups = {
  'stream-info': [['apps/stream-info/dist', 'Streamer.bot/custom/stream-info/dist'], ['apps/stream-info/change-info-streamer-bot.html', 'Streamer.bot/custom/stream-info/change-info-streamer-bot.html'], ['apps/stream-info/streamerbot-import.txt', 'Streamer.bot/custom/stream-info/streamerbot-import.txt']],
  tuna: [['apps/tuna-widget/dist/obs-tuna-widget.html', 'obs-tuna-widget.html']],
  'brand-color-lab': [['apps/brand-color-lab/index.html', 'Streamer.bot/custom/get-brand-colors/index.html']],
  widgets: [['apps/obs-widgets/streamlabs-chat', 'streamlabs-chat'], ['apps/obs-widgets/output-stats/index.html', 'easy-output-stats.compact.html'], ...['social-strip','donors','twitch-badge','sounds'].map(name => [`apps/obs-widgets/${name}`, `Streamer.bot/custom/assets/${name}`])],
  artwork: [
    ['artwork', 'maseaaao.tv/src'],
    ['artwork/assets', 'maseaaao.tv/assets'],
    ['packages/design', 'maseaaao.tv/assets/design'],
    ['packages/design/fonts', 'maseaaao.tv/assets/fonts'],
    ...['Geologica.ttf','Unbounded.ttf'].map(name => [`packages/design/fonts/${name}`, `maseaaao.tv/assets/cyber-monolith/${name}`]),
    ['apps/website/public/assets/avatar-288.webp', 'maseaaao.tv/assets/avatar-288.webp'],
  ],
};
if (!(product in groups)) throw Error(`Unknown product: ${product}. Choose ${Object.keys(groups).join(', ')}`);
const contained = (root, file) => {
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== file) throw Error('Path escapes its root');
};
const entries = [];
function rejectLinks(root, file) {
  for(let current=file; current!==root; current=dirname(current)) {
    contained(root,current);
    if(existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error('Deployment cannot follow symbolic links or junctions');
  }
}
function collect(source, destination) {
  contained(repo, source); contained(obs, destination);
  rejectLinks(repo,source); rejectLinks(obs,destination);
  if (!existsSync(source)) throw Error(`Build the product first: ${relative(repo, source)}`);
  const list = readdirSync(dirname(source), {withFileTypes:true});
  if (list.find(item => item.name === relative(dirname(source), source))?.isDirectory()) {
    for (const item of readdirSync(source, {withFileTypes:true})) {
      if (item.isSymbolicLink()) throw Error('Symbolic links cannot be deployed');
      if (item.name === 'assets' && source === resolve(repo, 'artwork')) continue;
      if (item.name === 'review' || item.name.endsWith('-report.json')) continue;
      collect(resolve(source, item.name), resolve(destination, item.name));
    }
  } else entries.push({source, destination});
}
for (const [source, target] of groups[product]) collect(resolve(repo, source), resolve(obs, target));
// Resolve dependencies in the source layout, then rewrite for the destination.
// Preparing every payload first also makes a missing dependency fail before writes.
const targets = new Map();
for (const {source,destination} of entries) {
  if (!targets.has(source)) targets.set(source,[]);
  targets.get(source).push(destination);
}
const aliases = new Map([
  [resolve(repo,'apps/website/public/assets/brand.css'),resolve(repo,'packages/design/brand.css')],
  [resolve(repo,'apps/website/public/assets/cyber-monolith/tokens.css'),resolve(repo,'artwork/assets/cyber-monolith/tokens.css')],
]);
for (const item of entries) {
  item.content = readFileSync(item.source);
  if (product !== 'artwork' || !/\.(html|css)$/.test(item.source)) continue;
  item.content = Buffer.from(item.content.toString('utf8').replace(
    /(?:src|href)=["']([^"']+)["']|url\(["']?([^\s"')]+)["']?\)/g,
    (match,attribute,url) => {
      const ref = attribute || url;
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(ref)) return match;
      const [path] = ref.split(/[?#]/);
      const source = resolve(dirname(item.source),decodeURIComponent(path));
      const candidates = targets.get(aliases.get(source) || source);
      if (!candidates) throw Error(`Missing deployment dependency: ${relative(repo,item.source)} -> ${ref}`);
      const destination = [...candidates].sort((a,b) => relative(dirname(item.destination),a).length - relative(dirname(item.destination),b).length)[0];
      const updated = relative(dirname(item.destination),destination).split(sep).join('/') + ref.slice(path.length);
      return match.replace(ref,updated);
    },
  ));
}
const hash = content => createHash('sha256').update(content).digest('hex');
const changed = entries.filter(item => !existsSync(item.destination) || hash(item.content) !== hash(readFileSync(item.destination)));
const backup = resolve(obs, 'Streamer.bot/backup', 'monorepo-sync-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + product);
for (const {source, destination, content} of changed) {
  console.log(`${args.includes('--apply') ? 'COPY' : 'PLAN'} ${relative(repo, source)} -> ${relative(obs, destination)}`);
  if (!args.includes('--apply')) continue;
  // Preserve every overwritten file before writing any new bytes to that path.
  if (existsSync(destination)) {
    const saved = resolve(backup, relative(obs, destination)); contained(backup, saved);
    mkdirSync(dirname(saved), {recursive:true}); copyFileSync(destination, saved);
  }
  mkdirSync(dirname(destination), {recursive:true}); writeFileSync(destination, content);
}
console.log(`${changed.length} files ${args.includes('--apply') ? 'updated' : 'would change'}. No Actions, databases or OBS settings are edited.`);
if (args.includes('--apply') && changed.length) console.log(`Backup: ${backup}`);
