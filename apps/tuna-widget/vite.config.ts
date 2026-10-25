import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';

export default standaloneConfig({
  budgets: { html: 2_000_000, js: 2_000_000 },
  fileName: 'obs-tuna-widget.html',
  outDir: '../../../dist/tuna-widget',
  root: fileURLToPath(new URL('./src/', import.meta.url)),
});
