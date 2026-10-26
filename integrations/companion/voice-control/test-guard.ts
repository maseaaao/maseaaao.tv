import assert from 'node:assert/strict';
import { StreamGuard } from './guard.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let state = false,
  calls: string[] = [];
const g = new StreamGuard({
  dispatch: async (name) => calls.push(name),
  read: async () => state,
  update: () => {
    /* Заглушка зависимости: поведение не требуется по умолчанию. */
  },
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

// A late result from an old request must not release a newer dispatch.
let rejectOld: ((reason: Error) => void) | undefined;
let rejectNew: ((reason: Error) => void) | undefined;
let requests = 0;
const restarted = new StreamGuard({
  dispatch: () =>
    new Promise((_resolve, reject) => {
      requests += 1;
      if (requests === 1) {
        rejectOld = reject;
      } else {
        rejectNew = reject;
      }
    }),
  read: () => Promise.resolve(false),
  startMs: 1,
  update: () => {
    /* No UI side effects in this test. */
  },
});
restarted.status(false);
restarted.down();
await sleep(10);
restarted.up();
restarted.destroy();
restarted.offline();
restarted.status(false);
restarted.down();
await sleep(10);
restarted.up();
const currentTimeout = restarted.timeout;
rejectOld?.(new Error('old request failed'));
await sleep(0);
assert.equal(restarted.busy, true);
assert.equal(restarted.target, true);
assert.equal(restarted.timeout, currentTimeout);
restarted.down();
await sleep(10);
assert.equal(requests, 2);
// Releasing the physical hold must not suppress the current request's failure.
rejectNew?.(new Error('current request failed'));
await sleep(0);
assert.equal(restarted.busy, false);
assert.equal(restarted.target, undefined);
restarted.destroy();
console.log(
  'PASS: stale dispatch cannot release a newer operation; current failure still clears busy after key release.',
);
