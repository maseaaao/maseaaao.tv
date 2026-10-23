import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { selectShard } from '../tooling/ci-tests.mjs';

// Partition the real suite: adding a file cannot silently omit it from CI.
test('repository shards are disjoint, complete, deterministic and nonempty', () => {
  const files = readdirSync(new URL('../tests/', import.meta.url)).filter((file) =>
    file.endsWith('.test.mjs'),
  );
  const shards = [1, 2, 3].map((index) => selectShard(files, `${index}/3`));
  assert(shards.every((shard) => shard.length));
  assert.deepEqual(shards.flat().sort(), [...files].sort());
  assert.equal(new Set(shards.flat()).size, files.length);
  assert.deepEqual(selectShard([...files].reverse(), '2/3'), shards[1]);
});

test('invalid shard specifications fail rather than silently omitting tests', () => {
  for (const shard of ['0/3', '4/3', '1/0', '1/2/3', '-1/3', '1.5/3', '', '1/NaN'])
    assert.throws(() => selectShard(['a.test.mjs'], shard), /shard/i);
});
