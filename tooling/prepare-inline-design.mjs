import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const css=readFileSync(resolve(root,'packages/design/brand.css'),'utf8');
const tokens=css.match(/:root\s*\{[^}]+\}/)[0];
for(const name of ['apps/brand-color-lab/index.html','apps/obs-widgets/output-stats/index.html']) {
  const file=resolve(root,name);
  let html=readFileSync(file,'utf8');
  const generated=`/* shared-design:start */\n${tokens}\n/* shared-design:end */`;
  if(html.includes('/* shared-design:start */')) html=html.replace(/\/\* shared-design:start \*\/.*?\/\* shared-design:end \*\//s,generated);
  else html=html.replace(/(<style(?:\s[^>]*)?>)/,`$1\n${generated}\n`);
  writeFileSync(file,html);
}
console.log('Embedded shared light tokens in standalone utility interfaces.');
