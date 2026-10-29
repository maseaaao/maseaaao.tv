import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { prepareModuleMetadata } from '../shared/package-module';

// Exported for build-only verification without compiling/running audio helpers.
export async function buildModule() {
  const output = prepareModuleMetadata(new URL('./', import.meta.url), 'install.json');
  await build({
    bundle: true,
    entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
    format: 'esm',
    outfile: join(output, 'main.js'),
    platform: 'node',
    target: 'node22',
  });
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  execFileSync(
    'dotnet',
    [
      'build',
      fileURLToPath(new URL('./AudioHelper.csproj', import.meta.url)),
      '--configuration',
      'Release',
      '--output',
      fileURLToPath(new URL('../../../dist/companion/voice-control/', import.meta.url)),
    ],
    { stdio: 'inherit' },
  );
  await buildModule();
}
