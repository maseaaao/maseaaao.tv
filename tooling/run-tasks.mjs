import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pinned = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
if (process.versions.node !== pinned)
  throw new Error(`Use Node ${pinned}, got ${process.versions.node}`);
const bunVersion = readFileSync(new URL('../.bun-version', import.meta.url), 'utf8').trim();
const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
if (bun.error) throw bun.error;
if (bun.status !== 0 || bun.stdout.trim() !== bunVersion)
  throw new Error(`Use Bun ${bunVersion}, got ${bun.stdout.trim() || bun.stderr}`);
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/turbo/bin/turbo', import.meta.url)),
    'run',
    ...process.argv.slice(2),
    '--cache=local:rw',
    '--concurrency=3',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: '1',
      MASEAAAO_TOOLCHAIN: `${process.platform}-${process.arch}-node${pinned}-bun${bunVersion}`,
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
