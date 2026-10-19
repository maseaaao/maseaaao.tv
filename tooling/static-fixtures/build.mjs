import { buildVuePages } from '@maseaaao/build-config/static';
import { fileURLToPath } from 'node:url';
const relative = (value) => fileURLToPath(new URL(value, import.meta.url));
await buildVuePages({
  root: relative('./src/'),
  ssrEntry: 'render.mjs',
  outDir: relative('../../.build-cache/static-fixtures/'),
  cacheDir: relative('../../.build-cache/static-fixtures-build/'),
  pages: ['index', 'interactive', 'artwork'].map((name) => ({
    source: `${name}.html`,
    output: name === 'artwork' ? 'examples/artwork.html' : `${name}.html`,
    budgets: {
      html: name === 'interactive' ? 250000 : 175000,
      js: name === 'interactive' ? 80000 : 0,
    },
  })),
});
