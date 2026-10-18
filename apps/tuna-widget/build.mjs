import {readFileSync, writeFileSync, mkdirSync, readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';

const source = resolve(import.meta.dirname, 'src/index.html');
let html = readFileSync(source, 'utf8').replace(/\r\n?/g,'\n');
const fontData = file => {
  const mime = file.endsWith('.ttf') ? 'font/ttf' : 'font/woff2';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
};
html = html.replace(/<link rel="stylesheet" href="([^"]+)"\s*\/>/g, (_, href) => {
  const cssFile = resolve(dirname(source), href);
  const css = readFileSync(cssFile, 'utf8').replace(/url\(["']?([^\)"']+)["']?\)/g,
    (_, font) => `url("${fontData(resolve(dirname(cssFile), font))}")`);
  return `<style>${css}</style>`;
});
html = html.replace(/url\("([^"\n]+\.ttf)"\)/g, (_, font) => `url("${fontData(resolve(dirname(source), font))}")`);
const licenses=resolve(import.meta.dirname,'licenses');
const notices=readdirSync(licenses).sort().map(name=>readFileSync(resolve(licenses,name),'utf8').replace(/\r\n?/g,'\n')).join('\n\n');
html=html.replace('</head>',`<script type="text/plain" id="font-licenses">${notices.replaceAll('</script','<\\/script')}</script>\n</head>`);
mkdirSync(resolve(import.meta.dirname, 'dist'), {recursive: true});
writeFileSync(resolve(import.meta.dirname, 'dist/obs-tuna-widget.html'), html);
console.log('Built standalone Tuna HTML with embedded local fonts.');
