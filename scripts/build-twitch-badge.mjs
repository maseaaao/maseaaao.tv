import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {textPath} from './noir-text.mjs';

// Shared opaque overlay; OBS owns each scene's position independently.
const output=path.resolve(import.meta.dirname,'../../Streamer.bot/custom/assets/twitch-badge');
await fs.mkdir(output,{recursive:true});
const copy=textPath('twitch / maseaaao',30);
const width=Math.ceil(48+copy.width+44);
const icon='M11.571 4.714h1.715v5.143h-1.715zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z';
// Lavender sticker: pale face, dark ink, violet offset edge, small bottom-left corner.
// Keep the existing 446x80 canvas so every OBS transform remains unchanged.
const face=`M28 1H${width-33}Q${width-6} 1 ${width-6} 28V46Q${width-6} 73 ${width-33} 73H9Q1 73 1 65V28Q1 1 28 1Z`;
// Center the actual Twitch outline (x=1.714..22.286, y=0..24) inside its tile.
// Tile center=(38.5,37); outline size=32.9152x38.4. Text baseline stays unchanged.
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="80" viewBox="0 0 ${width} 80"><path d="${face}" transform="translate(5 6)" fill="#9146ff"/><path d="${face}" fill="#e3d4ff" stroke="#f5efff" stroke-width="2"/><rect x="14" y="12.5" width="49" height="49" rx="15" fill="#c4a2fb"/><g transform="translate(22 48)"><path fill="#341254" transform="translate(-2.7 -30.2) scale(1.6)" d="${icon}"/><path fill="#341254" transform="translate(48 0)" d="${copy.d}"/></g></svg>`;
await fs.writeFile(path.join(output,'twitch-badge.svg'),svg);
await sharp(Buffer.from(svg)).png().toFile(path.join(output,'twitch-badge.png'));
console.log(JSON.stringify({width,height:80,output}));
