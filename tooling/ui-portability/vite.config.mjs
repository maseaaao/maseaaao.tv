import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { standaloneConfig } from '@maseaaao/build-config';

const config = standaloneConfig({
  root: fileURLToPath(new URL('./src/', import.meta.url)),
  outDir: '../../../.build-cache/ui-portability',
  fileName: 'ui-portability.html',
  nonce: 'ui-portability-probe',
});
export default { ...config, plugins: [vue(), ...config.plugins] };
