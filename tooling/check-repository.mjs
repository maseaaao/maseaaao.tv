import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const json = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const pkg = json('package.json');
assert(pkg.private && !pkg.version, 'Root package must not have a product version');
assert.equal(json('wrangler.jsonc').assets.directory, './dist');
assert.equal(json('apps/stream-info/package.json').name, 'change-info-streamer-bot');
for (const file of ['apps/website/public/index.html','apps/stream-info/streamerbot/action.cs','packages/design/brand.css','apps/tuna-widget/src/index.html']) assert(existsSync(resolve(root,file)), file);
function files(dir) {
  return readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    if (['node_modules','.git','bin','obj','review','.local'].includes(entry.name)) return [];
    return entry.isDirectory() ? files(resolve(dir,entry.name)) : [resolve(dir,entry.name)];
  });
}
for (const app of ['apps/website/public','apps/stream-info/src','apps/brand-color-lab','apps/obs-widgets']) {
  for (const file of files(resolve(root,app)).filter(file => /\.(html|css|ts|js)$/.test(file))) {
    const text = readFileSync(file,'utf8');
    assert(!/prefers-color-scheme:\s*dark|data-theme-value=|color-scheme:\s*dark/.test(text), `Unexpected theme switching: ${file}`);
    assert(!/^(?:<{7}|={7}|>{7})/m.test(text), `Conflict marker: ${file}`);
  }
}
// Every static website route is preserved in the publication folder, byte for byte.
for (const file of files(resolve(root,'apps/website/public'))) {
  const output = resolve(root,'dist',file.slice(resolve(root,'apps/website/public').length+1));
  assert(existsSync(output) && readFileSync(output).equals(readFileSync(file)), `Stale website publication: ${output}`);
}
for (const file of files(resolve(root,'artwork')).filter(file => /\.(html|css)$/.test(file))) {
  const text=readFileSync(file,'utf8');
  for (const match of text.matchAll(/(?:src|href)=["']([^"'#?]+)["']|url\(["']?([^\s"')]+)["']?\)/g)) {
    const url=match[1]||match[2];
    if (/^(?:https?:|data:|#|\/)/.test(url)) continue;
    assert(existsSync(resolve(dirname(file),url)), `Missing local artwork dependency: ${file} -> ${url}`);
  }
}
console.log('Repository structure, light appearance, static publication parity and artwork dependencies verified.');
