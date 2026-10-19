import { fileURLToPath } from 'node:url';
import { vueStandaloneConfig } from '@maseaaao/build-config/vue';

export default vueStandaloneConfig({
  root: fileURLToPath(new URL('./src/', import.meta.url)),
  outDir: '../../../.build-cache/ui-portability',
  fileName: 'ui-portability.html',
  nonce: 'ui-portability-probe',
  budgets: { html: 300000, js: 120000 },
});
