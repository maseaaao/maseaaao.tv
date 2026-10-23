import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
import { build } from 'vite';

for (const name of ['index', 'dock', 'scene']) {
  const config = standaloneConfig({
    root: fileURLToPath(new URL('../docs/ui-renewal/', import.meta.url)),
    outDir: `../../.build-cache/ui-reference-staging/${name}`,
    fileName: `${name}.html`,
  });
  config.build.rollupOptions = {
    input: fileURLToPath(new URL(`../docs/ui-renewal/${name}.html`, import.meta.url)),
  };
  await build({ ...config, configFile: false });
  const output = new URL('../.build-cache/ui-reference/', import.meta.url);
  await mkdir(output, { recursive: true });
  await cp(
    new URL(`../.build-cache/ui-reference-staging/${name}/${name}.html`, import.meta.url),
    new URL(`${name}.html`, output),
  );
}
