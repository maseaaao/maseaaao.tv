import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function selectShard(files, shard) {
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error('Expected shard INDEX/TOTAL');
  const [index, total] = shard.split('/').map(Number);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index > total)
    throw new Error('Invalid shard index/total');
  return [...files].sort().filter((_, offset) => offset % total === index - 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--shard')
    throw new Error('Usage: node tooling/ci-tests.mjs --shard INDEX/TOTAL');
  const files = readdirSync(resolve(root, 'tests')).filter((file) => file.endsWith('.test.mjs'));
  const selected = selectShard(files, process.argv[3]);
  if (!selected.length) throw new Error('Empty test shard');
  console.log(`Repository shard ${process.argv[3]}: ${selected.length}/${files.length} files`);
  // Each runner owns its output tree. Some tests rebuild dist, so never run
  // files concurrently within the same shard (parallelism is across jobs).
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...selected.map((file) => `tests/${file}`)],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
