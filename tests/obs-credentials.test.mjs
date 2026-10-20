import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../tooling/artwork/browser.mjs';

const file = pathToFileURL(
  resolve(import.meta.dirname, '../apps/obs-widgets/dist/output-stats/index.html'),
).href;
const storageKey = 'easy-output-stats.credentials.v1';
async function fixture(context, gate) {
  await context.addInitScript((gate) => {
    window.fixtureUrls = [];
    window.fixtureWaiting = false;
    let release;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    window.fixtureRelease = () => release();
    const method = gate === 'key' ? 'generateKey' : gate === 'encrypt' ? 'encrypt' : 'decrypt';
    const original = crypto.subtle[method].bind(crypto.subtle);
    crypto.subtle[method] = async (...args) => {
      if (gate !== 'decrypt' || localStorage.getItem('fixture-gate-restore')) {
        window.fixtureWaiting = true;
        await ready;
      }
      return original(...args);
    };
    const store = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'easy-output-stats.credentials.v1') window.fixtureRecord = value;
      return store.call(this, key, value);
    };
    window.WebSocket = class extends EventTarget {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 1;
      constructor(url) {
        super();
        window.fixtureUrls.push(url);
        queueMicrotask(() => {
          this.dispatchEvent(new Event('open'));
          this.reply({ op: 0, d: { rpcVersion: 1 } });
        });
      }
      reply(data) {
        queueMicrotask(() =>
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })),
        );
      }
      send(raw) {
        const data = JSON.parse(raw);
        if (data.op === 1) this.reply({ op: 2, d: { negotiatedRpcVersion: 1 } });
        if (data.op === 6)
          this.reply({
            op: 7,
            d: {
              requestId: data.d.requestId,
              requestStatus: { result: true },
              responseData: { outputs: [] },
            },
          });
      }
      close() {
        this.readyState = 3;
      }
    };
  }, gate);
}
async function remember(page, password) {
  await page.locator('#target-password').fill(password);
  await page.locator('#remember-credentials').check();
  await page.locator('#connect-button').click();
}

test(
  'two OBS pages creating a key concurrently can decrypt both committed records',
  { timeout: 30000 },
  async () => {
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext();
      await fixture(context, 'key');
      const pages = await Promise.all([context.newPage(), context.newPage()]);
      await Promise.all(pages.map((page) => page.goto(file)));
      await Promise.all(pages.map((page, index) => remember(page, 'fixture-' + index)));
      await Promise.all(pages.map((page) => page.waitForFunction(() => window.fixtureWaiting)));
      await Promise.all(pages.map((page) => page.evaluate(() => window.fixtureRelease())));
      await Promise.all(
        pages.map((page) => page.waitForFunction(() => Boolean(window.fixtureRecord))),
      );
      const records = await Promise.all(
        pages.map((page) => page.evaluate(() => window.fixtureRecord)),
      );
      const decoded = await pages[0].evaluate(async (records) => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open('easy-output-stats-secure-storage');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          // Read the actual controller-owned key, without exporting its material.
          const storeName = database.objectStoreNames[0];
          const keys = await new Promise((resolve, reject) => {
            const request = database.transaction(storeName).objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const key = keys.find((key) => key instanceof CryptoKey);
          if (!key) throw Error('No committed credential key');
          return Promise.all(
            records.map(async (serialized) => {
              const record = JSON.parse(serialized);
              const bytes = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
              const decoded = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: bytes(record.iv) },
                key,
                bytes(record.ciphertext),
              );
              return JSON.parse(new TextDecoder().decode(decoded)).password;
            }),
          );
        } finally {
          database.close();
        }
      }, records);
      assert.deepEqual(decoded, ['fixture-0', 'fixture-1']);
      await context.close();
    } finally {
      await browser.close();
    }
  },
);

test(
  'forget during pending credential encryption cannot restore the removed record',
  { timeout: 30000 },
  async () => {
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext();
      await fixture(context, 'encrypt');
      const page = await context.newPage();
      await page.goto(file);
      await remember(page, 'fixture-never-commit');
      await page.waitForFunction(() => window.fixtureWaiting);
      await page.locator('#forget-button').click();
      await page.evaluate(() => window.fixtureRelease());
      await page.waitForFunction(() => !document.querySelector('#remember-credentials').checked);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), null);
      assert.equal(await page.evaluate(() => window.fixtureRecord || null), null);
      await context.close();
    } finally {
      await browser.close();
    }
  },
);

test(
  'manual OBS connection wins over a delayed startup credential restore',
  { timeout: 30000 },
  async () => {
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext();
      await fixture(context, 'decrypt');
      const page = await context.newPage();
      await page.goto(file);
      await remember(page, 'fixture-stored');
      await page.waitForFunction(() => Boolean(window.fixtureRecord));
      await page.evaluate(() => localStorage.setItem('fixture-gate-restore', '1'));
      await page.reload();
      await page.waitForFunction(() => window.fixtureWaiting);
      await page.locator('#target-url').fill('ws://127.0.0.1:60667/');
      await page.locator('#target-password').fill('fixture-manual');
      await page.locator('#connect-button').click();
      await page.waitForFunction(() => window.fixtureUrls.length === 1);
      await page.evaluate(() => window.fixtureRelease());
      await page.waitForFunction(() =>
        document.querySelector('#status-text').textContent.includes('Подключено'),
      );
      assert.deepEqual(await page.evaluate(() => window.fixtureUrls), ['ws://127.0.0.1:60667/']);
      await context.close();
    } finally {
      await browser.close();
    }
  },
);
