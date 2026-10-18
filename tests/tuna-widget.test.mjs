import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchBrowser} from '../tooling/artwork/browser.mjs';

test('standalone Tuna renders a track and pause using only mocked local API responses', async () => {
  const html=readFileSync(new URL('../apps/tuna-widget/dist/obs-tuna-widget.html',import.meta.url),'utf8');
  assert(!html.includes('maseaaao.tv/assets/'));
  assert(html.includes('data:font/ttf;base64,'));
  const browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:1000,height:134},colorScheme:'dark'});
  let playing=true;
  const requests=[], errors=[];
  try {
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=route.request().url();requests.push(url);
      if(url.startsWith('http://localhost:1608/')) return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({title:'Тестовый трек',artists:['Тестовый исполнитель'],playing})});
      return route.abort();
    });
    await page.setContent(html);
    await page.waitForFunction(()=>document.querySelector('#player').dataset.play==='1');
    assert.equal(await page.locator('#title').textContent(),'Тестовый трек');
    assert((await page.locator('#subtitle').textContent()).includes('Тестовый исполнитель'));
    await page.evaluate(()=>document.fonts.ready);
    assert(await page.evaluate(()=>document.fonts.check('400 20px Geologica')));
    playing=false;
    await page.waitForFunction(()=>document.querySelector('#player').dataset.play==='0');
    assert.deepEqual(errors,[]);
    assert(requests.every(url=>url.startsWith('http://localhost:1608/')),'No external UI dependencies');
  } finally {await browser.close();}
});
