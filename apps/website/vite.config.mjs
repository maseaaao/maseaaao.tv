import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { generatedWebsiteImages } from '../../tooling/website-assets.mjs';

export default defineConfig(async () => {
  const generated = generatedWebsiteImages(fileURLToPath(new URL('../../', import.meta.url)));
  const root = fileURLToPath(new URL('./src/', import.meta.url));
  return {
    root,
    publicDir: '../public',
    base: '/',
    plugins: [
      {
        name: 'generated-website-images',
        generateBundle(_options, bundle) {
          for (const [fileName, source] of generated) {
            if (fileName in bundle || fileName === 'bundles' || fileName.startsWith('bundles/'))
              throw Error(`Website resource collision: ${fileName}`);
            this.emitFile({ type: 'asset', fileName, source });
          }
        },
      },
      {
        name: 'website-page-budgets',
        generateBundle(_options, bundle) {
          let jsBytes = 0;
          for (const entry of Object.values(bundle)) {
            if (entry.type !== 'chunk') continue;
            jsBytes += Buffer.byteLength(entry.code);
          }
          if (jsBytes > 12000) throw Error(`Website JS budget exceeded: ${jsBytes} > 12000`);
          for (const entry of Object.values(bundle)) {
            if (
              entry.type === 'asset' &&
              entry.fileName.endsWith('.html') &&
              Buffer.byteLength(entry.source) > 25000
            )
              throw Error(`Website HTML budget exceeded: ${entry.fileName}`);
          }
        },
      },
      {
        name: 'font-resources',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'licenses/Unbounded-OFL.txt',
            source: readFileSync(
              new URL(import.meta.resolve('@maseaaao/design/license')),
              'utf8',
            ).replace(/\r\n?/g, '\n'),
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
        output: {
          assetFileNames: (asset) =>
            asset.names.some((name) => name.endsWith('.css'))
              ? 'bundles/site-[hash][extname]'
              : 'bundles/[name]-[hash][extname]',
        },
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
  };
});
