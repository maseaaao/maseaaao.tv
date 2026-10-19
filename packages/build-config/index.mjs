import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, basename } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const license = readFileSync(
  new URL(import.meta.resolve('@maseaaao/design/license')),
  'utf8',
).replaceAll('\r\n', '\n');
export function standaloneConfig({ root, outDir, fileName, nonce }) {
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
  return defineConfig({
    root,
    base: './',
    publicDir: false,
    html: { cspNonce: nonce },
    plugins: [
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
    ],
    build: { outDir, emptyOutDir: true, target: 'es2022' },
  });
}
