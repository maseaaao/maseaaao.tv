import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch='C:/Users/maseaaao/AppData/Local/hermes/cache/scratch';
const helper=path.resolve(root,'../Streamer.bot/custom/maintenance/cyber-monolith/backup.py');
const reserve=target=>execFileSync('python',[helper,'reserve',target],{encoding:'utf8'});
const baseline=JSON.parse(await fs.readFile(path.join(root,'scripts/cyber-site-baseline.json'),'utf8'));
const server=http.createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep))throw Error('invalid');const bytes=await fs.readFile(p);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'})[path.extname(p)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const evidence=[];
async function ready(page){await page.evaluate(async()=>{await document.fonts.ready;for(const name of ['Unbounded','Geologica']){const faces=await document.fonts.load(`600 16px "${name}"`,'maseaaao АБВ');if(!faces.length||faces.some(f=>f.status!=='loaded'))throw Error('Font missing: '+name);}for(const img of document.images){await img.decode();if(!img.naturalWidth)throw Error('Image missing');}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
try{
 for(const item of baseline.exports){
  const page=await browser.newPage({viewport:{width:item.width,height:item.height},deviceScaleFactor:1,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/'+item.path.replace('/rendered/','/').replace(/\.jpeg$/,'.html'),{waitUntil:'load'});await ready(page);
  if(errors.length)throw Error(errors.join('; '));
  const dest=path.join(root,item.path);reserve(dest);
  const bytes=await sharp(await page.screenshot({type:'png'})).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
  const meta=await sharp(bytes).metadata();if(meta.width!==item.width||meta.height!==item.height)throw Error('Wrong export dimensions');
  await fs.writeFile(dest,bytes);evidence.push({path:dest,width:meta.width,height:meta.height,bytes:bytes.length});console.log(`RENDERED ${item.path} ${meta.width}x${meta.height} ${bytes.length} bytes`);await page.close();
 }
 for(const spec of [
  {url:'dist/index.html',width:1440,height:1100,name:'landing-desktop'},
  {url:'dist/index.html',width:320,height:1000,name:'landing-320'},
  {url:'dist/index.html',width:390,height:1000,name:'landing-390'},
  {url:'dist/index.html',width:768,height:1100,name:'landing-768'},
  {url:'dist/check.html',width:390,height:1000,name:'checker-390'},
  {url:'dist/docs.html',width:320,height:1000,name:'docs-320'},
  {url:'src/banners/twitch-schedule.html',width:1200,height:480,name:'twitch-banner'},
  {url:'src/banners/youtube-schedule.html',width:2560,height:1440,name:'youtube-banner'}
 ]){
  const page=await browser.newPage({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:1,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/'+spec.url);await ready(page);if(errors.length)throw Error(errors.join('; '));
  const dest=path.join(scratch,'cyber-site-'+spec.name+'.png');reserve(dest);await page.screenshot({path:dest,fullPage:true});console.log('SCREENSHOT '+dest);evidence.push({screenshot:dest,width:spec.width});await page.close();
 }
 const panels=baseline.exports.filter(x=>x.path.includes('twitch-description'));
 const contact=path.join(scratch,'cyber-site-twitch-panels.png');reserve(contact);
 await sharp({create:{width:320,height:panels.length*80,channels:3,background:'#050608'}}).composite(await Promise.all(panels.map(async(x,i)=>({input:await fs.readFile(path.join(root,x.path)),left:0,top:i*80})))).png().toFile(contact);evidence.push({screenshot:contact});
 const report=path.join(scratch,'cyber-site-render-evidence.json');reserve(report);await fs.writeFile(report,JSON.stringify(evidence,null,2));
 console.log(`Verified ${baseline.exports.length} exports; evidence ${report}`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
