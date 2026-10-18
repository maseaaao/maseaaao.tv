import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {launchBrowser} from './browser.mjs';

export async function buildDarkScenes() {
 const scenes=path.resolve(import.meta.dirname,'../src/scenes');
 const source=path.resolve(scenes,'../scenes-dark');
 const rendered=path.join(source,'rendered');
 const preview=path.join(rendered,'review');
 for(const dir of [source,rendered,preview]) await fs.mkdir(dir,{recursive:true});
 const layout=JSON.parse(await fs.readFile(path.join(scenes,'layout.json'),'utf8'));
 const originals=[path.join(scenes,'obs-scene.css'),path.join(scenes,'layout.json'),...layout.files.flatMap(x=>[path.join(scenes,x.file),path.join(scenes,'rendered',x.name+'.webp')])];
 const before=await Promise.all(originals.map(p=>fs.readFile(p)));
 await fs.writeFile(path.join(source,'tokens.css'),`@import url('../../dist/assets/brand.css');
/* Dark counterpart of the project's warm-light / blue identity. */
:root{color-scheme:dark;--surface:#20201e;--surface-solid:#20201e;--text:#f4f3ec;--dim:#b9b9b0;--line:#53534e;--line-strong:#8d8d84;--accent:#1616d9;--hud-bg:var(--surface);--hud-surface:#292927;--hud-raised:#333330;--hud-border:var(--line);--hud-text:var(--text);--hud-muted:var(--dim);--hud-accent:var(--accent)}
`);
 await fs.writeFile(path.join(source,'obs-scene.css'),before[0].toString('utf8')+`
/* Separate dark variant; geometry and transparent live regions are retained. */
.title-field{background:var(--accent);border:0;border-radius:24px}
h1{color:var(--hud-text)}.header-rule{background:var(--hud-border)}
.camera-frame{border-color:var(--hud-text)}.panel{background:var(--hud-surface)}
`);
 const browser=await launchBrowser();const outputs=[],errors=[];
 try {
  for(const item of layout.files){
   let html=await fs.readFile(path.join(scenes,item.file),'utf8');
   html=html.replace('../../assets/cyber-monolith/tokens.css','tokens.css').replace('--hud-bg:#1616d9;','');
   await fs.writeFile(path.join(source,item.file),html);
   const page=await browser.newPage({viewport:{width:item.width,height:item.height},deviceScaleFactor:1});
   try {
    page.on('pageerror',e=>errors.push(e.message));
    page.on('requestfailed',r=>errors.push('Failed scene asset: '+r.url().split('?')[0]));
    await page.route(/^https?:\/\//,r=>r.abort());
    await page.goto(pathToFileURL(path.join(source,item.file)).href);
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
    const png=await page.screenshot({omitBackground:true,animations:'disabled'});
    await fs.writeFile(path.join(preview,item.name+'.png'),png);
    await sharp(png).webp({lossless:true}).toFile(path.join(rendered,item.name+'.webp'));
    const meta=await sharp(png).metadata();assert.equal(meta.width,item.width);assert.equal(meta.height,item.height);
    outputs.push({name:item.name,width:meta.width,height:meta.height});
   }finally{await page.close();}
  }
 }finally{await browser.close();}
 assert.deepEqual(errors,[]);
 const blank=await sharp(path.join(rendered,'00-blank.webp')).raw().toBuffer();assert.deepEqual([...blank.subarray(0,3)],[32,32,30]);
 const transparent=await sharp(path.join(rendered,'00-blank-vertical.webp')).stats();assert.equal(transparent.channels[3].max,0);
 for(let i=0;i<originals.length;i++) assert.deepEqual(await fs.readFile(originals[i]),before[i],'Original changed: '+originals[i]);
 await fs.writeFile(path.join(source,'layout.json'),JSON.stringify({...layout,design:'Тёмная',files:layout.files.map(f=>({...f,rendered:`rendered/${f.name}.webp`}))},null,2));
 const report={source,rendered,preview,outputs,errors,originalsUnchanged:true};
 await fs.writeFile(path.join(rendered,'build-report.json'),JSON.stringify(report,null,2));
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)) {
 const result=await buildDarkScenes();
 console.log(JSON.stringify({rendered:result.outputs.length,errors:result.errors.length,originalsUnchanged:result.originalsUnchanged,source:result.source}));
}
