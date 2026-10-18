import {copyFileSync, mkdirSync, rmSync, readdirSync, chmodSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'apps/website/public');
// Only this exact publication directory may be cleared, never an app's sources.
const dist = resolve(root, 'dist');
function copyTree(from, to) {
  mkdirSync(to, {recursive:true});
  for (const entry of readdirSync(from,{withFileTypes:true})) {
    const source=resolve(from,entry.name), target=resolve(to,entry.name);
    if(entry.isDirectory()) copyTree(source,target);
    else copyFileSync(source,target);
  }
}
function writable(directory) {
  for (const entry of readdirSync(directory,{withFileTypes:true})) {
    const file=resolve(directory,entry.name);
    if(entry.isDirectory()) writable(file);
    chmodSync(file,entry.isDirectory() ? 0o777 : 0o666);
  }
  chmodSync(directory,0o777);
}
for (const assets of [resolve(source, 'assets')]) {
  mkdirSync(assets, {recursive: true});
  copyFileSync(resolve(root, 'packages/design/brand.css'), resolve(assets, 'brand.css'));
  copyTree(resolve(root, 'packages/design/fonts'), resolve(assets, 'fonts'));
  copyTree(resolve(root, 'packages/design/licenses'), resolve(assets, 'fonts/licenses'));
}
if(existsSync(dist)) writable(dist);
rmSync(dist, {recursive: true, force: true});
copyTree(source, dist);
console.log('Website prepared in dist; public URLs and Wrangler assets.directory are unchanged.');
