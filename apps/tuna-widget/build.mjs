import { buildVuePages } from '@maseaaao/build-config/static';
import { fileURLToPath } from 'node:url';

const local = (name) => fileURLToPath(new URL(name, import.meta.url));
await buildVuePages({
  root: local('./src/'),
  ssrEntry: '../render.mjs',
  outDir: local('./dist/'),
  cacheDir: local('../../.build-cache/tuna/'),
  pages: [
    {
      source: 'index.html',
      output: 'obs-tuna-widget.html',
      budgets: { html: 200000, js: 12000 },
    },
  ],
});
