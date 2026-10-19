import { standaloneConfig } from '@maseaaao/build-config';
import { fileURLToPath } from 'node:url';
export default ({ mode: product }) => {
  if (!['social-strip', 'output-stats'].includes(product)) throw Error('Unknown standalone widget');
  return {
    ...standaloneConfig({
      root: fileURLToPath(new URL('./src/' + product, import.meta.url)),
      outDir: '../../dist/' + product,
      fileName: 'index.html',
      nonce: product === 'output-stats' ? 'MgyZalLFWAZRipi5-O9bEdvvw-6jjJU5' : undefined,
    }),
    publicDir: product === 'social-strip' ? 'public' : false,
  };
};
