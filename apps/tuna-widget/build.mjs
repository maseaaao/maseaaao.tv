import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
import { build } from 'vite';

const root = fileURLToPath(new URL('./src/', import.meta.url));
const config = standaloneConfig({
  root,
  outDir: '../dist',
  fileName: 'obs-tuna-widget.html',
  budgets: { html: 500000, js: 12000 },
});
config.build.modulePreload = false;
await build({ ...config, configFile: false });
