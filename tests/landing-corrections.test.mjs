import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {launchBrowser} from '../scripts/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamRef = '636683ebd6aec6e5a456baabf111865dc1c46cfd';
const upstream = file => execFileSync('git', ['show', `${upstreamRef}:${file}`], {cwd: root});
const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
const css = await fs.readFile(path.join(root, 'dist/assets/site.css'), 'utf8');
let browser, server, origin;

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + decodeURIComponent(name));
      if (!file.startsWith(root + path.sep)) throw Error('invalid path');
      res.setHeader('Content-Type', ({'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png'})[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

// Preserve the upstream player lifecycle with only two approved chat-default changes.
// Only Twitch SDK/iframe networking is substituted; no live messages/events escape.
const sdk = `(() => {
  class Player {
    static READY='ready'; static ONLINE='online'; static OFFLINE='offline';
    static PLAYBACK_BLOCKED='blocked'; static PLAYING='playing';
    constructor(id, options) {
      this.handlers={}; this.options=options; this.calls=[];
      window.__twitchPlayer=this;
      const frame=document.createElement('iframe'); frame.src='https://player.twitch.tv/?mock=1';
      frame.width='100%'; frame.height='100%'; document.getElementById(id).replaceChildren(frame);
    }
    addEventListener(name, fn) { (this.handlers[name]??=[]).push(fn); }
    emit(name) { for(const fn of this.handlers[name]??[]) fn(); }
    setMuted(value) { this.calls.push(['setMuted',value]); }
    play() { this.calls.push(['play']); }
  }
  window.Twitch={Player};
})();`;

async function newPage({width = 1440, sdkState = 'mock', javaScriptEnabled = true, htmlOverride, cssOverride, clock = false, reducedMotion = 'reduce'} = {}) {
  const context = await browser.newContext({viewport: {width, height: 1000}, reducedMotion, javaScriptEnabled});
  const page = await context.newPage();
  const traffic = {fonts: [], errors: [], external: []};
  page.on('pageerror', error => traffic.errors.push(error.message));
  page.on('response', response => {
    if (/\.(ttf|woff2?)(\?|$)/.test(response.url())) traffic.fonts.push({url: response.url(), status: response.status()});
  });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/dist/index.html' && htmlOverride) return route.fulfill({contentType: 'text/html; charset=utf-8', body: htmlOverride});
    if (url === origin + '/dist/assets/site.css' && cssOverride) return route.fulfill({contentType: 'text/css', body: cssOverride});
    if (url.startsWith(origin + '/')) return route.continue();
    traffic.external.push(url);
    if (url === 'https://player.twitch.tv/js/embed/v1.js') {
      if (sdkState === 'error') return route.abort('failed');
      if (sdkState === 'constructor-error') return route.fulfill({contentType: 'application/javascript', body: 'window.Twitch={Player:class {constructor(){throw Error("isolated constructor failure")}}};'});
      if (sdkState === 'missing') return route.fulfill({contentType: 'application/javascript', body: '/* missing SDK */'});
      return route.fulfill({contentType: 'application/javascript', body: sdk});
    }
    return route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Изолированный Twitch</title><body style="margin:0;background:#050608;color:#96a1b3;font:14px sans-serif">Изолированный Twitch: сеть подменена для аудита</body></html>'});
  });
  if (clock) await page.clock.install();
  await page.goto(origin + '/dist/index.html');
  if (javaScriptEnabled) await page.evaluate(() => document.fonts.ready);
  return {page, context, traffic};
}

async function emit(page, ...names) {
  await page.waitForFunction(() => window.__twitchPlayer);
  await page.evaluate(names => names.forEach(name => window.__twitchPlayer.emit(name)), names);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('one watch CTA remains in loading, online, offline and error; redundant fallback copy is absent', async () => {
  assert.doesNotMatch(html, /Если плеер не загрузился/);
  for (const width of [320,390,540,768,900,1024,1300,1440,1920]) {
    for (const state of ['loading','online','offline','error']) {
      const {page,context,traffic}=await newPage({sdkState:state==='error'?'error':'mock'});
      try {
        if(state==='error') await page.waitForFunction(()=>document.querySelector('[data-stream-layout]').dataset.state==='error');
        else if(state!=='loading') await emit(page,'ready',state);
        await page.setViewportSize({width,height:1000});
        const links=await page.locator('a[href="https://www.twitch.tv/maseaaao"]').evaluateAll(es=>es.filter(e=>e.checkVisibility()&&e.getBoundingClientRect().height&&!e.textContent.includes('чат')).map(e=>e.textContent));
        assert.equal(links.length,1,`${state}/${width}: ${links}`);
        assert.equal(await page.locator('.tile--twitch').isVisible(),true);
        assert.equal(await page.locator('[data-player-fallback]').textContent(),'');
        assert.equal(await page.locator('[data-player-fallback]').isVisible(),false);
        assert.deepEqual(traffic.errors,[]);
      } finally {await context.close();}
    }
  }
});

test('donation and its hover state remain readable in the shared palette', async () => {
  const {page,context}=await newPage();
  try {
    const tile=page.locator('.tile--donationalerts');
    assert.equal(await tile.evaluate(e=>getComputedStyle(e).color),'rgb(32, 32, 30)');
    await tile.hover();
    assert.equal(await tile.evaluate(e=>getComputedStyle(e).color),'rgb(22, 22, 217)');
  } finally { await context.close(); }
});

test('wide layout places media next to links and narrow layout follows document order', async () => {
  for (const width of [320,390,540,768,900,1024,1440,1920]) {
    const {page,context}=await newPage();
    try {
      await emit(page,'ready','online');
      await page.setViewportSize({width,height:1000});
      const boxes=await page.evaluate(()=>Object.fromEntries(['identity','stream-layout','actions','collab'].map(name=>{const r=document.querySelector('.'+name).getBoundingClientRect();return [name,{x:r.x,y:r.y,right:r.right,bottom:r.bottom}]})));
      const {identity,'stream-layout':media,actions,collab}=boxes;
      assert.ok(actions.y>=identity.bottom);
      if (width>1000) {
        assert.ok(actions.x>=media.right);
        assert.equal(actions.y,media.y);
      } else {
        assert.ok(media.y>=actions.bottom);
      }
      assert.ok(collab.y>=Math.max(media.bottom,actions.bottom));
      assert.equal(await page.locator('[data-chat-frame]').count(),1);
    } finally { await context.close(); }
  }
});

test('arrows stay still during hover and focus; reduced motion disables transitions', async () => {
  for (const reducedMotion of ['no-preference','reduce']) {
    const {page,context}=await newPage({reducedMotion});
    try {
      const tile=page.locator('.tile--twitch');
      await tile.hover();
      assert.equal(await tile.locator('.tile__arrow').evaluate(e=>getComputedStyle(e).transform),'none');
      await page.keyboard.press('Tab');
      await tile.focus();
      assert.equal(await tile.evaluate(e=>getComputedStyle(e).outlineWidth),'3px');
      assert.equal(await tile.locator('.tile__arrow').evaluate(e=>getComputedStyle(e).transform),'none');
      if(reducedMotion==='reduce') assert.equal(await tile.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    } finally { await context.close(); }
  }
});

test('cold fractional content respects the exact 402px SDK boundary with one available watch CTA',async()=>{
  for(const contentWidth of [401,401.5,401.984375,402,402.5,403]){
    const {page,context,traffic}=await newPage({cssOverride:css+`\n.stream-content{width:${contentWidth}px}`});
    try{
      await page.waitForTimeout(80);
      const narrow=contentWidth<402;
      assert.equal(await page.evaluate(()=>Boolean(window.__twitchPlayer)),!narrow,`${contentWidth}px SDK threshold`);
      assert.equal(await page.locator('.stream-mobile').isVisible(),narrow);
      assert.equal(await page.locator('.tile--twitch').isVisible(),true);
      if(!narrow){await emit(page,'ready','online');const box=await page.locator('#twitch-player iframe').boundingBox();assert.ok(box.width>=400);assert.ok(box.height>=300);}
      else assert.equal(traffic.external.filter(url=>url.includes('/js/embed/')).length,0);
      assert.deepEqual(traffic.errors,[]);
    }finally{await context.close();}
  }
});

test('chat defaults open on nonmobile in every stream state and cold narrow desktop; mobile stays lazy',async()=>{
  for(const state of ['loading','online','offline','error']){
    const {page,context,traffic}=await newPage({sdkState:state==='error'?'error':'mock'});
    try{
      if(state==='error')await page.waitForFunction(()=>document.querySelector('[data-stream-layout]').dataset.state==='error');
      else if(state!=='loading')await emit(page,'ready',state);
      for(const width of [320,390,540,650,651,768,900,1000,1440]){
        await page.setViewportSize({width,height:1000});
        await page.waitForFunction(expected=>document.querySelector('[data-stream-chat]').open===expected,width>650);
        assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open),width>650,`${state}/${width}`);
      }
      assert.deepEqual(traffic.errors,[]);
    }finally{await context.close();}
  }
  for(const width of [320,650,651,768,900,1440]){
    const {page,context,traffic}=await newPage({width});
    try{
      assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open),width>650,`cold/${width}`);
      const src=await page.locator('[data-chat-frame]').getAttribute('src');
      if(width>650){assert.ok(src);assert.equal(new URL(src).searchParams.get('parent'),'127.0.0.1');}
      else assert.equal(src,null,'a cold mobile page must not load a collapsed chat iframe');
      assert.deepEqual(traffic.errors,[]);
    }finally{await context.close();}
  }
});

test('manual chat choice wins over nonmobile defaults through resize and stream-state changes',async()=>{
  const {page,context}=await newPage();
  try{
    const summary=page.locator('[data-stream-chat] summary');
    assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open),true);
    await summary.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open),false);
    await emit(page,'ready','online','offline');
    await page.setViewportSize({width:390,height:1000});await page.setViewportSize({width:768,height:1000});
    assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open),false);
    await summary.focus();await page.keyboard.press('Space');
    assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open),true);
    await emit(page,'online');await page.setViewportSize({width:390,height:1000});
    assert.equal(await page.locator('[data-stream-chat]').evaluate(e=>e.open),true);
  }finally{await context.close();}
});

if(process.env.LANDING_DETAIL_OUT){
  test('capture measured left-chat geometry, watch CTA count and normal-motion browser states',async()=>{
    const directory=path.resolve(process.env.LANDING_DETAIL_OUT);
    await fs.mkdir(directory,{recursive:false});
    function reserve(file){
      const helper=path.resolve(root,'../Streamer.bot/backup/cyber-fixes-20261012-004631/reserve.py');
      execFileSync('python',['-c',`import importlib.util,sys;s=importlib.util.spec_from_file_location('reserve',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.reserve(sys.argv[2])`,helper,file]);
    }
    const rows=[];
    for(const width of [320,390,540,768,900,1024,1300,1440,1920]){
      const {page,context,traffic}=await newPage({reducedMotion:'no-preference'});
      try{
        await emit(page,'ready','online');await page.setViewportSize({width,height:1000});await page.waitForTimeout(900);
        const measurement=await page.evaluate(()=>({
          boxes:Object.fromEntries(['identity','stream-content','stream-chat','actions'].map(name=>{const e=document.querySelector('.'+name),r=e.getBoundingClientRect();return [name,{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}]})),
          watchCTAs:[...document.querySelectorAll('a[href="https://www.twitch.tv/maseaaao"]')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().height&&!e.textContent.includes('чат')).length,
          fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family),
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
          donation:{background:getComputedStyle(document.querySelector('.tile--donationalerts')).backgroundColor,ink:getComputedStyle(document.querySelector('.tile--donationalerts .tile__meta')).color},
        }));
        const file=path.join(directory,`normal-motion-online-${width}.png`);reserve(file);await page.screenshot({path:file,fullPage:true});
        assert.equal(measurement.watchCTAs,1);assert.equal(measurement.overflow,false);assert.deepEqual(traffic.errors,[]);
        rows.push({width,...measurement,errors:traffic.errors,screenshot:file});
        if(width===1440){
          await page.locator('.tile--donationalerts').hover();await page.waitForTimeout(260);
          const hover=path.join(directory,'donation-hover-desktop.png');reserve(hover);await page.screenshot({path:hover,fullPage:true});
          await page.mouse.move(0,0);await page.keyboard.press('Tab');await page.locator('[data-stream-chat] summary').focus();
          const focus=path.join(directory,'chat-focus-desktop.png');reserve(focus);await page.screenshot({path:focus,fullPage:true});
        }
      }finally{await context.close();}
    }
    const report=path.join(directory,'geometry-motion-evidence.json');reserve(report);await fs.writeFile(report,JSON.stringify({chromeVersion:browser.version(),externalNetwork:'Twitch SDK and frames mocked; not a real broadcast',rows},null,2));
  });
}
