import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
import { build } from 'vite';

const root = fileURLToPath(new URL('./src/', import.meta.url));
const config = standaloneConfig({ root, outDir: '../dist', fileName: 'obs-tuna-widget.html' });
config.build.modulePreload = false;
config.plugins.unshift({
  name: 'tuna-budgets',
  generateBundle(_options, bundle) {
    const bytes = Object.values(bundle)
      .filter((entry) => entry.type === 'chunk')
      .reduce((sum, entry) => sum + Buffer.byteLength(entry.code), 0);
    if (bytes > 12000) throw Error(`Tuna JS budget exceeded: ${bytes}`);
  },
});
await build({ ...config, configFile: false });
const html = await readFile(new URL('./dist/obs-tuna-widget.html', import.meta.url));
if (html.length > 500000) throw Error(`Tuna HTML budget exceeded: ${html.length}`);
