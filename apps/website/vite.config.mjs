import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./src/', import.meta.url)),
  publicDir: '../public',
  base: '/',
  plugins: [
    {
      name: 'font-resources',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'licenses/Unbounded-OFL.txt',
          source: readFileSync(new URL(import.meta.resolve('@maseaaao/design/license'))),
        });
      },
      transformIndexHtml: {
        order: 'post',
        handler(_html, context) {
          if (!context.bundle) return [];
          const font = Object.values(context.bundle).find(
            (asset) => asset.type === 'asset' && asset.fileName.endsWith('.woff2'),
          );
          return font
            ? [
                {
                  tag: 'link',
                  attrs: {
                    rel: 'preload',
                    href: '/' + font.fileName,
                    as: 'font',
                    type: 'font/woff2',
                    crossorigin: 'anonymous',
                  },
                  injectTo: 'head',
                },
              ]
            : [];
        },
      },
    },
  ],
  build: {
    outDir: '../../../dist',
    emptyOutDir: true,
    assetsDir: 'bundles',
    target: 'es2022',
    rollupOptions: {
      input: Object.fromEntries(
        [
          'index.html',
          'docs.html',
          'check.html',
          'tools/index.html',
          'tools/stream-info.html',
          'tools/tuna-widget.html',
        ].map((name) => [name, fileURLToPath(new URL('./src/' + name, import.meta.url))]),
      ),
    },
  },
});
