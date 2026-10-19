import assert from 'node:assert/strict';
import { StreamGuard } from './guard.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let state = false,
  calls = [];
const g = new StreamGuard({
  read: async () => state,
  dispatch: async (name) => calls.push(name),
  update: () => {},
});
g.status(false);
g.down();
await sleep(400);
g.up();
await sleep(2800);
assert.equal(calls.length, 0);
g.down();
await sleep(2850);
assert.equal(calls.length, 0);
await sleep(250);
assert.deepEqual(calls, ['STATE | START']);
await sleep(1600);
assert.equal(calls.length, 1);
g.up();
state = true;
g.status(true);
g.down();
await sleep(1700);
assert.equal(calls.length, 1);
await sleep(400);
assert.deepEqual(calls, ['STATE | START', 'STATE | STOP']);
g.up();
state = false;
g.status(false);
g.down();
await sleep(50);
g.offline();
await sleep(3100);
assert.equal(calls.length, 2);
g.status(false);
g.down();
state = true;
await sleep(3100);
assert.equal(calls.length, 2);
g.up();
g.destroy();
console.log(
  'PASS: real 3s / 2s timing, early release, one dispatch per hold, disconnect and changed-state cancellation; no live stream commands sent.',
);
