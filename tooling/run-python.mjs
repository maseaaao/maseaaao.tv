import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = fileURLToPath(new URL('../.runtime/venv/bin/python', import.meta.url));
const python = existsSync(local) ? local : 'python';
const result = spawnSync(python, process.argv.slice(2), { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
