import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('../shared/build-helper.ps1', import.meta.url)),
    '-ModuleDirectory',
    fileURLToPath(new URL('.', import.meta.url)),
    '-Name',
    'AudioHelper',
  ],
  { windowsHide: true, stdio: 'inherit' },
);
await build({
  entryPoints: [fileURLToPath(new URL('./index.js', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: fileURLToPath(new URL('./main.js', import.meta.url)),
  external: [],
});
