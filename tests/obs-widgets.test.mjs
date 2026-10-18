import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {launchBrowser} from '../tooling/artwork/browser.mjs';

test('output statistics uses the fixed light palette without connecting to a real OBS',async()=>{
  const browser=await launchBrowser();
  try {
    const page=await browser.newPage({colorScheme:'dark',viewport:{width:1000,height:700}});
    await page.addInitScript(()=>{
      window.WebSocket=class extends EventTarget {
        static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
        readyState=3;close(){}send(){}
      };
    });
    await page.goto(pathToFileURL(resolve(import.meta.dirname,'../apps/obs-widgets/output-stats/index.html')).href);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(255, 254, 248)');
    assert.equal(await page.locator('#target-password').inputValue(),'');
  } finally {await browser.close();}
});
