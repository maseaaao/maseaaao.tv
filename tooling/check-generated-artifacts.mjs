import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
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
const paths = git('ls-files', '--', ...targets)
  .split('\n')
  .filter(Boolean)
  .sort();
if (paths.length < 40)
  throw Error('Expected committed publication and artwork artifacts; check checkout completeness.');
const missing = [];
const lines = paths.map((file) => {
  if (!existsSync(resolve(root, file))) {
    missing.push(file);
    return '# MISSING  ' + file;
  }
  const hash = createHash('sha256')
    .update(readFileSync(resolve(root, file)))
    .digest('hex');
  return hash + '  ' + file;
});
const cache = resolve(root, '.build-cache/verify');
mkdirSync(cache, { recursive: true });
writeFileSync(resolve(cache, 'artifacts.sha256'), lines.join('\n') + '\n');

const modified = git('status', '--porcelain=v1', '--untracked-files=all', '--', ...targets);
if (modified || missing.length) {
  process.stderr.write('Stale/new generated artifacts: ' + '\n' + modified + '\n');
  throw Error('Generated assets differ from the committed release baseline.');
}
console.log('Verified ' + paths.length + ' tracked artifacts; manifest: ' + cache);
