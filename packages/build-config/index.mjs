import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const license = readFileSync(
  new URL(import.meta.resolve('@maseaaao/design/license')),
  'utf8',
).replaceAll('\r\n', '\n');

/**
 * @param {{
 *   root: string,
 *   outDir: string,
 *   fileName: string,
 *   nonce?: string,
 *   budgets?: { html: number, js: number },
 * }} options
 */
export function standaloneConfig({ root, outDir, fileName, nonce, budgets }) {
  const source = resolve(root);
  const output = resolve(source, outDir);
  const contains = (parent, child) => {
    const name = relative(parent, child);
    return name === '' || (name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name));
  };
  if (contains(source, output) || contains(output, source))
    throw Error('Standalone output must be separate from the source tree');
  if (basename(fileName) !== fileName || !fileName.endsWith('.html'))
    throw Error('Expected a single HTML filename');
  const plugins = [
    viteSingleFile({ outputFileName: fileName }),
    {
      name: 'font-license',
      transformIndexHtml: () => [
        {
          tag: 'script',
          attrs: { type: 'text/plain', id: 'unbounded-license', ...(nonce ? { nonce } : {}) },
          children: license,
          injectTo: 'head',
        },
      ],
    },
  ];
  if (budgets) {
    plugins.push({
      name: 'standalone-budgets',
      generateBundle(_options, bundle) {
        let jsBytes = 0;
        for (const entry of Object.values(bundle)) {
          if (entry.type !== 'chunk') continue;
          if (entry.code.trim()) jsBytes += Buffer.byteLength(entry.code);
        }
        if (jsBytes > budgets.js) throw Error(`JS budget exceeded: ${jsBytes} > ${budgets.js}`);
      },
      async writeBundle() {
        const html = await readFile(resolve(source, outDir, fileName));
        if (html.length > budgets.html)
          throw Error(`HTML budget exceeded: ${html.length} > ${budgets.html}`);
      },
    });
  }
  return defineConfig({
    root,
    base: './',
    publicDir: false,
    html: { cspNonce: nonce },
    plugins,
    build: { outDir, emptyOutDir: true, target: 'es2022' },
  });
}
