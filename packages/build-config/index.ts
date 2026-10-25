import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { PluginOption, UserConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const license = readFileSync(
  new URL(import.meta.resolve('@maseaaao/design/license')),
  'utf8',
).replaceAll('\r\n', '\n');

interface StandaloneOptions {
  budgets?: { html: number; js: number };
  fileName: string;
  nonce?: string;
  outDir: string;
  root: string;
}

export function standaloneConfig({ root, outDir, fileName, nonce, budgets }: StandaloneOptions) {
  const source = resolve(root);
  const output = resolve(source, outDir);
  const contains = (parent: string, child: string) => {
    const name = relative(parent, child);
    return name === '' || (name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name));
  };
  if (contains(source, output) || contains(output, source)) {
    throw new Error('Standalone output must be separate from the source tree');
  }
  if (basename(fileName) !== fileName || !fileName.endsWith('.html')) {
    throw new Error('Expected a single HTML filename');
  }
  const plugins: PluginOption[] = [
    viteSingleFile({ outputFileName: fileName }),
    {
      name: 'font-license',
      transformIndexHtml: () => [
        {
          attrs: { id: 'unbounded-license', type: 'text/plain', ...(nonce ? { nonce } : {}) },
          children: license,
          injectTo: 'head',
          tag: 'script',
        },
      ],
    },
  ];
  if (budgets) {
    plugins.push({
      generateBundle(_options, bundle) {
        let jsBytes = 0;
        for (const entry of Object.values(bundle)) {
          if (entry.type !== 'chunk') {
            continue;
          }
          if (entry.code.trim()) {
            jsBytes += Buffer.byteLength(entry.code);
          }
        }
        if (jsBytes > budgets.js) {
          throw new Error(`JS budget exceeded: ${jsBytes} > ${budgets.js}`);
        }
      },
      name: 'standalone-budgets',
      async writeBundle() {
        const html = await readFile(resolve(source, outDir, fileName));
        if (html.length > budgets.html) {
          throw new Error(`HTML budget exceeded: ${html.length} > ${budgets.html}`);
        }
      },
    });
  }
  return {
    base: './',
    build: { emptyOutDir: true, outDir, target: 'es2022' },
    html: { cspNonce: nonce },
    plugins,
    publicDir: false,
    root,
  } satisfies UserConfig;
}
