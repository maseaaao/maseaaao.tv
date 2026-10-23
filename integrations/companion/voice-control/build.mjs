import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

execFileSync(
  'dotnet',
  [
    'build',
    fileURLToPath(new URL('./AudioHelper.csproj', import.meta.url)),
    '--configuration',
    'Release',
    '--output',
    fileURLToPath(new URL('.', import.meta.url)),
  ],
  { stdio: 'inherit' },
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
