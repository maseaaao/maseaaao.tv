import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fontFace} from './design.mjs';
const root=resolve(import.meta.dirname,'..');
const css=readFileSync(resolve(root,'packages/design/brand.css'),'utf8');
const tokens=css.match(/:root\s*\{[^}]+\}/)[0];
for(const name of ['apps/obs-widgets/output-stats/index.html']) {
  const file=resolve(root,name);
  let html=readFileSync(file,'utf8');
  const generated=`/* shared-design:start */\n${tokens}\n/* shared-design:end */`;
  if(html.includes('/* shared-design:start */')) html=html.replace(/\/\* shared-design:start \*\/.*?\/\* shared-design:end \*\//s,generated);
  else html=html.replace(/(<style(?:\s[^>]*)?>)/,`$1\n${generated}\n`);
  writeFileSync(file,html);
}
console.log('Embedded shared light tokens in standalone utility interfaces.');

for (const name of [
  'apps/obs-widgets/output-stats/index.html',
  'apps/obs-widgets/social-strip/index.html',
  'apps/obs-widgets/streamlabs-chat/chat-box.css',
  'apps/obs-widgets/streamlabs-chat/donationalerts-alerts.css',
  'apps/obs-widgets/donors/donationalerts-stream-stats.css',
]) {
  const file=resolve(root,name);
  let content=readFileSync(file,'utf8');
  const generated=`/* shared-font:start */\n${fontFace}\n/* shared-font:end */`;
  if(content.includes('/* shared-font:start */')) content=content.replace(/\/\* shared-font:start \*\/.*?\/\* shared-font:end \*\//s,generated);
  else if(name.endsWith('.html')) content=content.replace(/(<style(?:\s[^>]*)?>)/,`$1\n${generated}\n`);
  else content=generated+'\n'+content;
  writeFileSync(file,content);
}
