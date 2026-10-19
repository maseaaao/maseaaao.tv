import vue from '@vitejs/plugin-vue';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { standaloneConfig } from './index.mjs';

/**
 * SFC compiler is build-only; only a single runtime-only Vue may reach the browser.
 * @param {{ budgets?: { html: number, js: number } } & Record<string, unknown>} options
 */
export function vueStandaloneConfig({ budgets, ...options }) {
  const config = standaloneConfig(options);
  let jsBytes = 0;
  const guard = {
    name: 'vue-runtime-contract',
    generateBundle(_options, bundle) {
      const roots = new Set();
      jsBytes = 0;
      for (const entry of Object.values(bundle)) {
        if (entry.type !== 'chunk') continue;
        if (entry.code.trim()) jsBytes += Buffer.byteLength(entry.code);
        for (const id of Object.keys(entry.modules)) {
          if (/[/\\]@vue[/\\]compiler-/.test(id))
            throw Error(`Browser compiler is forbidden: ${id}`);
          const normalized = id.replaceAll('\\', '/');
          const marker = normalized.indexOf('/@vue/runtime-core/');
          if (marker >= 0) roots.add(normalized.slice(0, marker));
        }
      }
      if (roots.size > 1) throw Error('Multiple Vue runtimes in one result');
      if (budgets && jsBytes > budgets.js)
        throw Error(`JS budget exceeded: ${jsBytes} > ${budgets.js}`);
    },
    async writeBundle() {
      if (!budgets) return;
      const html = await readFile(resolve(options.root, options.outDir, options.fileName));
      if (html.length > budgets.html)
        throw Error(`HTML budget exceeded: ${html.length} > ${budgets.html}`);
    },
  };
  return { ...config, plugins: [vue(), guard, ...config.plugins] };
}
