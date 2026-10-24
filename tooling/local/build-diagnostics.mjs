// Ship the storage helper with its ZIP reader, without runtime node_modules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

await build({
  configFile: false,
  build: {
    target: 'node22',
    outDir: fileURLToPath(new URL('../../build/diagnostics', import.meta.url)),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./compare-companion-storage.mjs', import.meta.url)),
      formats: ['es'],
      fileName: () => 'compare-companion-storage.mjs',
    },
    rollupOptions: {
      external: (id) => id.startsWith('node:'),
      output: {
        banner:
          '/*!\n' +
          readFileSync(new URL('../../node_modules/fflate/LICENSE', import.meta.url), 'utf8') +
          '\n*/',
      },
    },
  },
});
