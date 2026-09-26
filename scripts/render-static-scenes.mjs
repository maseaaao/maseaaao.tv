import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scenes=path.join(root,'src/scenes');
const output=path.join(scenes,'rendered');
await fs.mkdir(output,{recursive:true});
for(const file of (await fs.readdir(scenes)).filter(f=>f.endsWith('.html'))){
 const html=await fs.readFile(path.join(scenes,file),'utf8');
 const svg=html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
 if(!svg)throw new Error(`No static SVG in ${file}`);
 const vertical=file.includes('-vertical');
 const width=vertical?1080:2560,height=vertical?1920:1440;
 const target=path.join(output,file.replace(/\.html$/,'.webp'));
 const buffer=await sharp(Buffer.from(svg)).resize(width,height).webp({lossless:true}).toBuffer();
 const meta=await sharp(buffer).metadata();
 if(meta.width!==width||meta.height!==height)throw new Error(`Wrong dimensions: ${file}`);
 await fs.writeFile(target,buffer);
 console.log(`${file} -> ${path.basename(target)} (${width}x${height})`);
}
