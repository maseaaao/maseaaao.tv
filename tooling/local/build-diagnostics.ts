// Ship the storage helper with its ZIP reader, without runtime node_modules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

await build({
  build: {
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./compare-companion-storage.ts', import.meta.url)),
      fileName: () => 'compare-companion-storage.mjs',
      formats: ['es'],
    },
    minify: false,
    outDir: fileURLToPath(new URL('../../dist/diagnostics', import.meta.url)),
    rollupOptions: {
      external: (id) => id.startsWith('node:'),
      output: {
        banner:
          '/*!\n' +
          readFileSync(new URL('../node_modules/fflate/LICENSE', import.meta.url), 'utf8') +
          '\n*/',
      },
    },
    target: 'node22',
  },
  configFile: false,
});
