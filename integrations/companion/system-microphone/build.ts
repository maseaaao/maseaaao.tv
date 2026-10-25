import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { prepareModuleMetadata } from '../shared/package-module';

// Exported for build-only verification without compiling/running audio helpers.
export async function buildModule() {
  const output = prepareModuleMetadata(new URL('./', import.meta.url), 'request.json');
  await build({
    banner: { js: 'const __moduleUrl = require("node:url").pathToFileURL(__filename).href;' },
    bundle: true,
    define: { 'import.meta.url': '__moduleUrl' },
    entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
    format: 'cjs',
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
      fileURLToPath(new URL('./SystemAudioHelper.csproj', import.meta.url)),
      '--configuration',
      'Release',
      '--output',
      fileURLToPath(new URL('../../../dist/companion/system-microphone/', import.meta.url)),
    ],
    { stdio: 'inherit' },
  );
  await buildModule();
}
