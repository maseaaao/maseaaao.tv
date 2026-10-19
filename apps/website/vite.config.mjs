import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { relative, dirname, sep } from 'node:path';
import { prepareVuePages } from '@maseaaao/build-config/static';

export default defineConfig(async () => {
  const root = fileURLToPath(new URL('./src/', import.meta.url));
  const { renderPage, styleFile } = await prepareVuePages({
    root,
    ssrEntry: '../render.mjs',
    cacheDir: fileURLToPath(new URL('../../.build-cache/website/', import.meta.url)),
  });
  return {
    root: fileURLToPath(new URL('./src/', import.meta.url)),
    publicDir: '../public',
    base: '/',
    plugins: [
      {
        name: 'website-vue-pages',
        generateBundle(_options, bundle) {
          let jsBytes = 0;
          for (const entry of Object.values(bundle)) {
            if (entry.type !== 'chunk') continue;
            jsBytes += Buffer.byteLength(entry.code);
            if (Object.keys(entry.modules).some((id) => /[/\\](?:@vue|vue)[/\\]/.test(id)))
              throw Error('Static website must not ship Vue runtime or compiler');
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
        transformIndexHtml: {
          order: 'pre',
          async handler(html, context) {
            const name = relative(root, context.filename).split(sep).join('/');
            for (const marker of ['<!--page-content-->', '<!--page-styles-->'])
              if (html.split(marker).length !== 2) throw Error(`Expected exactly one ${marker}`);
            const rendered = await renderPage(name);
            if (typeof rendered !== 'string') throw Error('renderPage must return HTML');
            const styles = relative(dirname(context.filename), styleFile).split(sep).join('/');
            return html
              .replace('<!--page-content-->', () => rendered)
              .replace(
                '<!--page-styles-->',
                () => `<link rel="stylesheet" href="${encodeURI(styles)}">`,
              );
          },
        },
      },
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
