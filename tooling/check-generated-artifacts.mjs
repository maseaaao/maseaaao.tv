import { execFileSync } from 'node:child_process';
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
const modified = git('status', '--porcelain=v1', '--untracked-files=all', '--', ...targets);
if (modified) {
  process.stderr.write('Stale/new generated artifacts: ' + '\n' + modified + '\n');
  throw Error('Generated assets differ from the committed release baseline.');
}
console.log('Verified ' + paths.length + ' tracked artifacts against Git.');
