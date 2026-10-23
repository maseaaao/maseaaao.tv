import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dir = fileURLToPath(new URL('.', import.meta.url));
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
    dir,
    '-Name',
    'SystemAudioHelper',
    '-Json',
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
});
