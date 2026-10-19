import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { HelperProcess } from './helper-process.mjs';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
let offline = 0,
  lines = 0;
function fake() {
  const c = new EventEmitter();
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.kill = () => {
    c.killed = true;
  };
  children.push(c);
  return c;
}
const h = new HelperProcess({
  file: 'unused',
  timeout: 200,
  retry: 10,
  spawnProcess: fake,
  onLine: (s) => {
    JSON.parse(s);
    lines++;
  },
  onOffline: () => offline++,
});
h.start();
children[0].emit('error', new Error('mock'));
children[0].emit('close');
await delay(30);
assert.equal(children.length, 2);
assert.equal(offline, 1);
children[0].stdout.write('{"old":true}\n');
assert.equal(lines, 0);
children[1].stdout.write('{"available":true}\n');
assert.equal(lines, 1);
await delay(420);
assert.ok(children[1].killed);
assert.ok(children.length >= 3);
h.stop();
const stoppedCount = children.length;
await delay(80);
assert.equal(children.length, stoppedCount);
assert.equal(h.send('toggle'), false);
const firstReply = new HelperProcess({
  file: 'unused',
  timeout: 30,
  retry: 10,
  spawnProcess: fake,
  onLine: () => {},
  onOffline: () => {},
});
firstReply.start();
const silent = children.at(-1);
await delay(75);
assert.ok(silent.killed, 'first reply has a deadline');
firstReply.stop();
const malformed = new HelperProcess({
  file: 'unused',
  timeout: 200,
  retry: 10,
  spawnProcess: fake,
  onLine: (s) => JSON.parse(s),
  onOffline: () => {},
});
malformed.start();
const bad = children.at(-1);
bad.stdout.write('not-json\n');
assert.ok(bad.killed);
malformed.stop();
const bounded = new HelperProcess({
  file: 'unused',
  timeout: 200,
  retry: 10,
  spawnProcess: fake,
  onLine: () => {},
  onOffline: () => {},
});
bounded.start();
const flooding = children.at(-1);
flooding.stdout.write('x'.repeat(65537));
assert.ok(flooding.killed, 'unterminated output bounded');
bounded.stop();
console.log(
  'PASS: spawn error + close once, retry, stale child ignored, stalled helper, first reply deadline, stop cancels retry, invalid data; no real processes or commands.',
);
