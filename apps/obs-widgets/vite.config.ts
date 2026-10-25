import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
import { defineConfig } from 'vite';

export default defineConfig(({ mode: product }) => {
  if (product !== 'social-strip') {
    throw new Error('Unknown standalone widget');
  }
  const root = fileURLToPath(new URL('./src/' + product, import.meta.url));
  const config = standaloneConfig({
    fileName: 'index.html',
    outDir: '../../../../dist/obs-widgets/' + product,
    root,
  });
  config.plugins.push({
    generateBundle(_options, bundle) {
      let bytes = 0;
      for (const entry of Object.values(bundle)) {
        if (entry.type !== 'chunk') {
          continue;
        }
        bytes += Buffer.byteLength(entry.code);
      }
      if (bytes > 2_000_000) {
        throw new Error(`Widget JS budget exceeded: ${bytes} > 2000000`);
      }
    },
    name: 'static-widget-contract',
  });
  return { ...config, publicDir: 'public' };
});
