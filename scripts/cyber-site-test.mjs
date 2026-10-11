import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=JSON.parse(await fs.readFile(path.join(root,'scripts/cyber-site-baseline.json'),'utf8'));
const server=http.createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep))throw Error('invalid');const b=await fs.readFile(p);const ext=path.extname(p);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.ttf':'font/ttf'})[ext]||'application/octet-stream');res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' — '+e.message);}}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin+'/dist/index.html');
 await page.evaluate(()=>document.fonts.ready);
 await test('landing uses Cyber-Monolith surface and real loaded Geologica',async()=>{
  const result=await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily,loaded:[...document.fonts].filter(f=>f.family==='Geologica'&&f.status==='loaded').length}));
  assert.equal(result.bg,'rgb(5, 6, 8)');assert.match(result.font,/Geologica/);assert.ok(result.loaded>0,'Geologica must actually load');
 });
 await test('real public links and discovery metadata are preserved',async()=>{
  assert.deepEqual(await page.locator('a').evaluateAll(es=>es.map(e=>e.getAttribute('href'))),baseline['index.html'].anchors);
  assert.deepEqual(await page.locator('head meta, head link:not([rel="stylesheet"])').evaluateAll(es=>es.filter(e=>e.getAttribute('name')!=='theme-color').map(e=>[e.tagName.toLowerCase(),Object.fromEntries([...e.attributes].map(a=>[a.name,a.value]))])),baseline['index.html'].head);
 });
 await test('landing retains upstream source copy and local additions without inventing LIVE',async()=>{
  const source=await fs.readFile(path.join(root,'dist/index.html'),'utf8');
  const snapshot=await page.evaluate(source=>{
   const doc=new DOMParser().parseFromString(source,'text/html');
   const scripts=[...doc.querySelectorAll('script[src]')].map(e=>({src:e.getAttribute('src'),defer:e.hasAttribute('defer')}));
   const inlineScripts=[...doc.querySelectorAll('script:not([src])')].map(e=>e.textContent);
   doc.querySelectorAll('script,style').forEach(e=>e.remove());
   return {text:doc.body.textContent.replace(/\s+/g,''),title:doc.title,scripts,inlineScripts};
  },source);
  let text=snapshot.text;
  for(const copy of baseline['index.html'].localCopyAdditions){const token=copy.replace(/\s+/g,'');assert.ok(text.includes(token),'lost approved local copy '+copy);text=text.replace(token,'');}
  assert.equal(text,baseline['index.html'].sourceText);
  assert.equal(snapshot.title,baseline['index.html'].title);
  assert.deepEqual(snapshot.scripts,baseline['index.html'].externalScripts);
  assert.deepEqual(snapshot.inlineScripts,baseline['index.html'].script);
  assert.equal(await page.locator('[data-live-badge]').count(),1);
  assert.equal(await page.locator('[data-live-badge]').isVisible(),false,'no unverified LIVE on SDK error/loading');
  const stream=await fs.readFile(path.join(root,baseline['index.html'].upstreamStream.path));
  assert.equal(createHash('sha256').update(stream).digest('hex'),baseline['index.html'].upstreamStream.checkoutSha256,'upstream stream script bytes changed');
  assert.equal(await page.locator('.tile').first().getAttribute('href'),'https://www.twitch.tv/maseaaao');
 });
 for(const file of ['index.html','check.html','docs.html']){
  await page.goto(origin+'/dist/'+file);await page.evaluate(()=>document.fonts.ready);
  await test(file+' has angular Cyber-Monolith UI and loaded local typography',async()=>{
   const ui=await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily,faces:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family),radius:getComputedStyle(document.querySelector('.tile,.card,section')).borderRadius}));
   assert.equal(ui.bg,'rgb(5, 6, 8)');assert.match(ui.font,/Geologica/);assert.ok(ui.faces.includes('Geologica'));assert.ok(ui.faces.includes('Unbounded'));assert.ok(parseFloat(ui.radius)<=2);
  });
  if(file!=='index.html')await test(file+' keeps original content, links and executable script',async()=>{
   assert.deepEqual(await page.locator('a').evaluateAll(es=>es.map(e=>e.getAttribute('href'))),baseline[file].anchors);
   assert.equal((await page.locator('body').innerText()).replace(/\s+/g,''),baseline[file].text.join(''));
   assert.deepEqual(await page.locator('script:not([src])').evaluateAll(es=>es.map(e=>e.textContent)),baseline[file].script);
  });
  for(const width of [320,390,540,768,1440]){
   await page.setViewportSize({width,height:1000});
   await test(`${file} fits ${width}px with 44px controls`,async()=>{
    const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,small:[...document.querySelectorAll('a,button,input,select')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().width&&(e.getBoundingClientRect().height<44||e.getBoundingClientRect().width<44)).map(e=>e.textContent)}));
    assert.ok(layout.scroll<=layout.width,`overflow ${layout.scroll}>${layout.width}`);assert.deepEqual(layout.small,[]);
    const control=page.locator('a:visible,button:visible').first();if(await control.count()){await page.keyboard.press('Tab');await control.focus();assert.equal(await control.evaluate(e=>getComputedStyle(e).outlineWidth),'2px');assert.equal(await control.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');}

   });
  }
 }
 for(const folder of ['banners','twitch-description']){
  for(const file of (await fs.readdir(path.join(root,'src',folder))).filter(f=>f.endsWith('.html'))){
   await page.setViewportSize(folder==='banners'?{width:1200,height:480}:{width:320,height:64});
   await page.goto(`${origin}/src/${folder}/${file}`);await page.evaluate(()=>document.fonts.ready);
   await test(file+' is dark angular HUD with unclipped original headline',async()=>{
    const ui=await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,headline:document.querySelector('h1').textContent,sw:document.querySelector('h1').scrollWidth,cw:document.querySelector('h1').clientWidth,radius:getComputedStyle(document.querySelector('.twitch-panel,.composition')).borderRadius}));
    assert.equal(ui.bg,'rgb(5, 6, 8)');assert.ok(parseFloat(ui.radius)<=2);assert.ok(ui.sw<=ui.cw,`title clipped ${ui.sw}>${ui.cw}`);
    if(folder==='banners')assert.match(ui.headline,/ЗАЙДИ НА\s*СТРИМ/);else assert.equal(ui.headline,({'01-about.html':'Обо мне','02-rules.html':'Правила','03-donate.html':'Донат','04-devices.html':'Девайсы','05-specs.html':'Характеристики','06-settings.html':'Настройки'})[file]);
   });
  }
 }
 await page.goto(origin+'/dist/check.html');
 await test('checker add/remove actions and TV mode still work without external playback',async()=>{
  await page.locator('[data-action="add-all"]').click();assert.equal(await page.locator('iframe').count(),2);
  const srcs=await page.locator('iframe').evaluateAll(es=>es.map(e=>e.src));assert.ok(srcs[0].includes('UCyJNPWpOcPfMo5csKa27yGg'));assert.ok(srcs[1].includes('channel=maseaaao'));assert.ok(srcs[1].includes('parent=127.0.0.1'));
  await page.locator('[data-action="add-all"]').click();assert.equal(await page.locator('iframe').count(),2);
  await page.locator('[data-action="remove-all"]').click();assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('.placeholder').count(),2);
  await page.locator('[data-platform="twitch"] [data-action="add"]').click();assert.equal(await page.locator('iframe').count(),1);
  await page.locator('[data-platform="twitch"] [data-action="remove"]').click();assert.equal(await page.locator('iframe').count(),0);
  await page.goto(origin+'/dist/check.html?tv=1');assert.ok(await page.locator('body').evaluate(e=>e.classList.contains('is-tv-mode')));assert.equal(await page.locator('iframe').count(),2);
  assert.equal(new URL(await page.locator('[data-platform="youtube"] iframe').getAttribute('src')).searchParams.get('mute'),'0');
 });
 for(const item of baseline.exports){
  await test(item.path+' was rerendered at original export dimensions',async()=>{
   const bytes=await fs.readFile(path.join(root,item.path));
   assert.notEqual(createHash('sha256').update(bytes).digest('hex'),item.originalSha256,'unchanged original export');
   const meta=await sharp(bytes).metadata();assert.equal(meta.width,item.width);assert.equal(meta.height,item.height);assert.equal(meta.format,'jpeg');
   const {data}=await sharp(bytes).extract({left:2,top:Math.floor(item.height/2),width:1,height:1}).raw().toBuffer({resolveWithObject:true});assert.ok(data[0]<40&&data[1]<40&&data[2]<40,'near-black export surface');
  });
 }
 await page.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({passed,failed}));process.exitCode=failed?1:0;
