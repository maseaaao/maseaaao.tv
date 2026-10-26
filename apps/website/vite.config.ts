import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Image, { generateHTML } from '@11ty/eleventy-img';
import { defineConfig, type UserConfig } from 'vite';
import { generatedWebsiteImages } from '../../tooling/website-assets.ts';

const websiteImageTypes: Record<string, string> = {
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export default defineConfig((): UserConfig => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const root = fileURLToPath(new URL('./src/', import.meta.url));

  const loadImages = async () => {
    const generated = generatedWebsiteImages(repoRoot);
    // The only content image of the site: one master from the artwork export,
    // variants and the <img srcset sizes> markup are produced by @11ty/eleventy-img
    // at build time so browsers pick the file that fits display size and pixel density.
    const avatarMaster = 'assets/avatar-master.png';
    const avatarWidths = [64, 96, 128, 192, 256, 288, 384, 512];
    const avatarCacheDir = join(repoRoot, 'dist/.cache/website-images');
    const avatarMeta = await Image(join(repoRoot, 'dist/artwork/brand/website', avatarMaster), {
      filenameFormat: (_id: number, _src: string, width: number, format: string) =>
        `avatar-${width}.${format}`,
      formats: ['webp'],
      outputDir: avatarCacheDir,
      sharpWebpOptions: { effort: 6, quality: 88 },
      urlPath: '/assets/',
      widths: avatarWidths,
    });
    const avatarMarkup = generateHTML(
      avatarMeta,
      {
        alt: '',
        class: 'avatar',
        decoding: 'async',
        fetchpriority: 'high',
        loading: 'eager',
        sizes: '(max-width: 540px) 64px, 88px',
      },
      { fallback: 'smallest' },
    );
    const avatarFiles = new Map(
      (avatarMeta.webp ?? []).map((entry) => [
        `assets/${entry.filename}`,
        readFileSync(join(avatarCacheDir, entry.filename)),
      ]),
    );

    return { avatarFiles, avatarMarkup, avatarMaster, generated };
  };
  let images: ReturnType<typeof loadImages> | undefined;
  const getImages = () => {
    images ??= loadImages();
    return images;
  };

  return {
    base: '/',
    build: {
      assetsDir: 'bundles',
      emptyOutDir: true,
      outDir: '../../../dist/website',
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
        output: {
          assetFileNames: (asset) =>
            asset.names.some((name) => name.endsWith('.css'))
              ? 'bundles/site-[hash][extname]'
              : 'bundles/[name]-[hash][extname]',
        },
      },
      target: 'es2022',
    },
    plugins: [
      {
        async configureServer(server) {
          const { generated, avatarMaster, avatarFiles } = await getImages();
          server.middlewares.use((request, response, next) => {
            const name = new URL(request.url || '/', 'http://localhost').pathname.slice(1);
            const source =
              avatarFiles.get(name) ?? (name === avatarMaster ? null : generated.get(name));
            const type = websiteImageTypes[name.slice(name.lastIndexOf('.'))];
            if (!(source && type)) {
              next();
              return;
            }
            response.setHeader('Content-Type', type);
            response.end(source);
          });
        },
        async generateBundle(_options, bundle) {
          const { generated, avatarMaster, avatarFiles } = await getImages();
          for (const [fileName, source] of generated) {
            if (fileName === avatarMaster) {
              continue;
            }
            if (fileName in bundle || fileName === 'bundles' || fileName.startsWith('bundles/')) {
              throw new Error(`Website resource collision: ${fileName}`);
            }
            this.emitFile({ fileName, source, type: 'asset' });
          }
          for (const [fileName, source] of avatarFiles) {
            if (fileName in bundle || fileName === 'bundles' || fileName.startsWith('bundles/')) {
              throw new Error(`Website resource collision: ${fileName}`);
            }
            this.emitFile({ fileName, source, type: 'asset' });
          }
        },
        name: 'generated-website-images',
      },
      {
        generateBundle(_options, bundle) {
          let jsBytes = 0;
          for (const entry of Object.values(bundle)) {
            if (entry.type !== 'chunk') {
              continue;
            }
            jsBytes += Buffer.byteLength(entry.code);
          }
          if (jsBytes > 2_000_000) {
            throw new Error(`Website JS budget exceeded: ${jsBytes} > 2000000`);
          }
          for (const entry of Object.values(bundle)) {
            if (
              entry.type === 'asset' &&
              entry.fileName.endsWith('.html') &&
              Buffer.byteLength(entry.source) > 2_000_000
            ) {
              throw new Error(`Website HTML budget exceeded: ${entry.fileName}`);
            }
          }
        },
        name: 'website-page-budgets',
      },
      {
        name: 'responsive-avatar',
        transformIndexHtml: {
          async handler(html: string) {
            const marker = '<!--avatar-->';
            if (!html.includes(marker)) {
              return html;
            }
            const { avatarMarkup } = await getImages();
            return html.replace(marker, avatarMarkup);
          },
          order: 'post',
        },
      },
      {
        generateBundle() {
          this.emitFile({
            fileName: 'licenses/Unbounded-OFL.txt',
            source: readFileSync(
              new URL(import.meta.resolve('@maseaaao/design/license')),
              'utf8',
            ).replace(/\r\n?/g, '\n'),
            type: 'asset',
          });
        },
        name: 'font-resources',
        transformIndexHtml: {
          handler(_html, context) {
            if (!context.bundle) {
              return [];
            }
            const font = Object.values(context.bundle).find(
              (asset) => asset.type === 'asset' && asset.fileName.endsWith('.woff2'),
            );
            return font
              ? [
                  {
                    attrs: {
                      as: 'font',
                      crossorigin: 'anonymous',
                      href: '/' + font.fileName,
                      rel: 'preload',
                      type: 'font/woff2',
                    },
                    injectTo: 'head',
                    tag: 'link',
                  },
                ]
              : [];
          },
          order: 'post',
        },
      },
    ],
    publicDir: '../public',
    root,
  };
});
