import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { HelperProcess } from './helper-process.ts';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill() {
    this.killed = true;
  }
}
const children: FakeChild[] = [];
let offline = 0,
  lines = 0;
function fake() {
  const c = new FakeChild();
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
  onLine: (s) => {
    JSON.parse(s);
    lines += 1;
  },
  onOffline: () => {
    offline += 1;
  },
  retry: 10,
  spawnProcess: fake,
  timeout: 200,
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
  onLine: () => {
    /* Заглушка зависимости: поведение не требуется по умолчанию. */
  },
  onOffline: () => {
    /* Заглушка зависимости: поведение не требуется по умолчанию. */
  },
  retry: 10,
  spawnProcess: fake,
  timeout: 30,
});
firstReply.start();
const silent = children.at(-1);
assert(silent);
await delay(75);
assert.ok(silent.killed, 'first reply has a deadline');
firstReply.stop();
const malformed = new HelperProcess({
  file: 'unused',
  onLine: (s) => JSON.parse(s),
  onOffline: () => {
    /* Заглушка зависимости: поведение не требуется по умолчанию. */
  },
  retry: 10,
  spawnProcess: fake,
  timeout: 200,
});
malformed.start();
const bad = children.at(-1);
assert(bad);
bad.stdout.write('not-json\n');
assert.ok(bad.killed);
malformed.stop();
const bounded = new HelperProcess({
  file: 'unused',
  onLine: () => {
    /* Заглушка зависимости: поведение не требуется по умолчанию. */
  },
  onOffline: () => {
    /* Заглушка зависимости: поведение не требуется по умолчанию. */
  },
  retry: 10,
  spawnProcess: fake,
  timeout: 200,
});
bounded.start();
const flooding = children.at(-1);
assert(flooding);
flooding.stdout.write('x'.repeat(65_537));
assert.ok(flooding.killed, 'unterminated output bounded');
bounded.stop();
console.log(
  'PASS: spawn error + close once, retry, stale child ignored, stalled helper, first reply deadline, stop cancels retry, invalid data; no real processes or commands.',
);
