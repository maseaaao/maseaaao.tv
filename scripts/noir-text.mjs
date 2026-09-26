import fs from 'node:fs/promises';
import path from 'node:path';
import opentype from 'opentype.js';

const fontsDir=path.resolve(import.meta.dirname,'../assets/fonts');
const load=async name=>{
  const buf=await fs.readFile(path.join(fontsDir,name));
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  return opentype.parse(ab);
};
const cyr=await load('unbounded-cyrillic-600-normal.woff');
const lat=await load('unbounded-latin-600-normal.woff');
const pick=ch=>{
  if(cyr.charToGlyphIndex(ch)>0)return cyr;
  if(lat.charToGlyphIndex(ch)>0)return lat;
  return lat;
};

const finite=v=>Number.isFinite(v);

export function textPath(text,size,trackingEm=0){
  const p=new opentype.Path();
  let x=0;
  for(const ch of text){
    const font=pick(ch);
    const glyph=font.charToGlyph(ch);
    const gp=glyph.getPath(x,0,size);
    for(const c of gp.commands){
      const need=c.type==='C'?['x1','y1','x2','y2','x','y']:c.type==='Q'?['x1','y1','x','y']:c.type==='Z'?[]:['x','y'];
      if(need.every(k=>finite(c[k])))p.commands.push(c);
    }
    x+=glyph.advanceWidth*size/font.unitsPerEm+size*trackingEm;
  }
  return {d:p.toPathData(2),width:x};
}

const isCli=process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1].replaceAll('\\','/')}`).href;
if(isCli){
  const [text,size]=process.argv.slice(2);
  console.log(JSON.stringify(textPath(text,Number(size)||100)));
}
