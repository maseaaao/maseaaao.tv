import {readFileSync} from 'node:fs';

// One canonical web font serves the site and is embedded in standalone products.
const font = readFileSync(new URL('../packages/design/fonts/unbounded-600.woff2', import.meta.url)).toString('base64');
const license=readFileSync(new URL('../packages/design/licenses/Unbounded-OFL.txt', import.meta.url),'utf8').replaceAll('*/','* /');
export const fontFace = `/* ${license} */\n@font-face{font-family:Unbounded;font-style:normal;font-weight:600;font-display:swap;src:url("data:font/woff2;base64,${font}") format("woff2")}`;
