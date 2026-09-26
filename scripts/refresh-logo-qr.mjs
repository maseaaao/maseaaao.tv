import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {generateQrWithLogo} from './generate-qr-with-logo.mjs';

const root=path.resolve(import.meta.dirname,'..');
const logoDir=path.join(root,'src/logo');
const assets=path.join(root,'dist/assets');
const logo=await fs.readFile(path.join(logoDir,'logo.png'));
const url='https://maseaaao.tv';
await fs.mkdir(path.join(logoDir,'rendered'),{recursive:true});
// Preserve the approved original, including its colour and background.
await fs.writeFile(path.join(assets,'avatar-master.png'),logo);
for(const name of ['maseaaao']) {
 const image=await sharp(logo).resize(1920,540,{fit:'contain',background:{r:17,g:17,b:19,alpha:0}}).webp({lossless:true}).toBuffer();
 await fs.writeFile(path.join(logoDir,'rendered',name+'.webp'),image);
}
await sharp(logo).resize(1024,1024).png().toFile(path.join(logoDir,'rendered','avatar-1024.png'));
await sharp(logo).resize(256,256).png().toFile(path.join(logoDir,'rendered','avatar-256.png'));
// Circle crop: edges cut off, transparent outside the circle.
const circleMask=size=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#fff"/></svg>`);
for(const size of [1024,512,256]) {
  const base=await sharp(logo).resize(size,size,{fit:'cover',position:'centre'}).png().toBuffer();
  const circle=await sharp(base).composite([{input:circleMask(size),blend:'dest-in'}]).png().toBuffer();
  await fs.writeFile(path.join(logoDir,'rendered',`avatar-circle-${size}.png`),circle);
  if(size===1024)await fs.writeFile(path.join(logoDir,'rendered','logo-circle.webp'),await sharp(circle).webp({lossless:true}).toBuffer());
}
const result=await generateQrWithLogo({text:url,width:800,margin:4,errorCorrectionLevel:'H',logo,logoFraction:0.20,color:{dark:'#111113',light:'#eeeeee'},tile:{fill:'#eeeeee',stroke:'#eeeeee',strokeOpacity:0}});
const jpeg=await sharp(result.buffer).flatten({background:'#111113'}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
// Check both the saved JPEG representation and stream-sized versions, not just the PNG generator result.
const checks=[];
for(const size of [result.width,400,300,240,200]) {
 const {data,info}=await sharp(jpeg).resize(size,size).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const decoded=jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data;
 if(decoded!==url)throw Error(`QR decode failed at ${size}px`);
 checks.push(size);
}
await fs.writeFile(path.join(assets,'maseaaao.tv.jpeg'),jpeg);
await fs.writeFile(path.join(assets,'maseaaao.tv.png'),result.buffer);
const {stampScenes}=await import('./stamp-scenes.mjs');
await stampScenes();
console.log(`Approved logo installed; existing logo canvas retained at 1920x540. QR -> ${url}; decoded JPEG at ${checks.join(', ')} px. Scenes stamped.`);
