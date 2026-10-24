import { afterAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { plugin, resolveSync } from 'bun';
import { JSDOM } from 'jsdom';

// Keep Vite's ?raw contract without changing production imports.
plugin({
  name: 'test-raw-imports',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, ({ path, importer }) => ({
      path: resolveSync(path.slice(0, -4), dirname(importer)),
      namespace: 'test-raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'test-raw' }, ({ path }) => ({
      exports: { default: readFileSync(path, 'utf8') },
      loader: 'object',
    }));
  },
});

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const globals = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLButtonElement',
  'Element',
  'Node',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'StorageEvent',
  'MutationObserver',
  'CompositionEvent',
  'getComputedStyle',
];
const descriptors = new Map(
  globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
for (const key of globals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? dom.window : Reflect.get(dom.window, key),
  });
}
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
