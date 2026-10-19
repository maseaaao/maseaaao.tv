import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mkdir, cp, access } from 'node:fs/promises';
import { resolve, relative, join, basename, dirname, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vueStandaloneConfig } from './vue.mjs';

function outsideSource(source, output) {
  const child = relative(source, output);
  const parent = relative(output, source);
  const outside = (name) => name === '..' || name.startsWith('..' + sep) || isAbsolute(name);
  if (!outside(child) || !outside(parent)) throw Error('Output must be separate from source');
}
function replaceMarker(html, marker, content) {
  if (html.indexOf(marker) < 0 || html.indexOf(marker) !== html.lastIndexOf(marker))
    throw Error(`Expected exactly one ${marker}`);
  return html.replace(marker, () => content);
}

/** Official Vue SSR -> Vite HTML pipeline. No browser runtime for static pages. */
export async function buildVuePages({ root, ssrEntry, pages, outDir, cacheDir }) {
  root = resolve(root);
  outDir = resolve(outDir);
  cacheDir = resolve(cacheDir);
  outsideSource(root, outDir);
  outsideSource(root, cacheDir);
  const names = new Set();
  for (const page of pages) {
    if (
      isAbsolute(page.output) ||
      /[\\:]/.test(page.output) ||
      page.output.split('/').some((part) => !part || part === '.' || part === '..') ||
      !page.output.endsWith('.html') ||
      names.has(page.output)
    )
      throw Error(`Invalid or duplicate output: ${page.output}`);
    names.add(page.output);
  }
  const ssrDir = join(cacheDir, 'ssr');
  await build({
    configFile: false,
    root,
    publicDir: false,
    plugins: [vue()],
    build: {
      ssr: resolve(root, ssrEntry),
      ssrEmitAssets: true,
      cssCodeSplit: false,
      assetsInlineLimit: Infinity,
      outDir: ssrDir,
      emptyOutDir: true,
      rollupOptions: {
        output: { entryFileNames: 'render.mjs', assetFileNames: '[name][extname]' },
      },
    },
  });
  await access(join(ssrDir, 'style.css'));
  const module = await import(
    pathToFileURL(join(ssrDir, 'render.mjs')).href + '?build=' + Date.now()
  );
  if (typeof module.renderPage !== 'function') throw Error('SSR entry must export renderPage');
  await mkdir(outDir, { recursive: true });
  for (const page of pages) {
    const source = resolve(root, page.source);
    const css = relative(dirname(source), join(ssrDir, 'style.css')).split(sep).join('/');
    const config = vueStandaloneConfig({
      root,
      outDir: join(cacheDir, page.output),
      fileName: basename(page.output),
      budgets: page.budgets,
    });
    config.build.modulePreload = false;
    config.build.rollupOptions = { input: source };
    config.plugins.push({
      name: 'vue-static-content',
      transformIndexHtml: {
        order: 'pre',
        async handler(html) {
          const rendered = await module.renderPage(page.output);
          if (typeof rendered !== 'string') throw Error('renderPage must return HTML');
          return replaceMarker(
            replaceMarker(html, '<!--page-content-->', rendered),
            '<!--page-styles-->',
            `<link rel="stylesheet" href="${encodeURI(css)}">`,
          );
        },
      },
    });
    await build({ ...config, configFile: false });
    await mkdir(dirname(join(outDir, page.output)), { recursive: true });
    await cp(join(cacheDir, page.output, basename(page.output)), join(outDir, page.output));
  }
}
