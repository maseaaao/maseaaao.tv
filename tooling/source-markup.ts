import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

export function checkFontFamilies(text: string, file: string) {
  for (const match of text.matchAll(
    /(?:font-family|--(?:font-body|font-display|hud-body|hud-display|hud-mono|display))\s*:\s*([^;}]+)/g,
  )) {
    // Variable definitions are checked too; strip references but keep fallback families.
    const families = match[1].replace(/var\(\s*--[\w-]+\s*(?:,\s*)?/g, '').replace(/\)/g, '');
    for (const family of families
      .replace(/!important/g, '')
      .split(',')
      .map((value) => value.trim().replace(/["']/g, ''))
      .filter(Boolean)) {
      assert(
        ['Arial', 'Unbounded', 'monospace', 'sans-serif', 'inherit'].includes(family),
        `Unexpected font ${family}: ${file}`,
      );
    }
  }
}

// Biome owns syntax and accessibility lint. Document-level contracts which
// have no Biome 2.6 equivalent stay with the repository's source checks.
export function checkSourceMarkup(source: string, file: string, { fragment = false } = {}) {
  const dom = new JSDOM(source, { virtualConsole: new VirtualConsole() });
  try {
    const { document } = dom.window;
    if (!fragment) {
      assert.equal(document.doctype?.name.toLowerCase(), 'html', `Missing HTML doctype: ${file}`);
      assert(document.documentElement.lang.trim(), `Missing document language: ${file}`);
      assert(
        document.querySelector('head > title')?.textContent?.trim(),
        `Missing document title: ${file}`,
      );
    }
    // Browser HTML parsing repairs nested buttons and anchors before exposing
    // the DOM. Renaming the interactive tags to custom elements keeps the
    // nesting intact for the walk.
    const parse = new JSDOM(
      source
        .replaceAll(/<(\/?)button\b/gi, '<$1markup-button')
        .replaceAll(/<(\/?)a\b/gi, '<$1markup-a'),
      { virtualConsole: new VirtualConsole() },
    );
    try {
      const tree = parse.window.document;
      const interactive = (node: Element) =>
        node.tagName === 'MARKUP-BUTTON' ||
        (node.tagName === 'MARKUP-A' && Boolean(node.getAttribute('href'))) ||
        (node.tagName === 'INPUT' && node.getAttribute('type') !== 'hidden');
      const walk = (node: Element | Document, insideInteractive = false): void => {
        const isInteractive = 'attributes' in node && interactive(node);
        if (isInteractive) {
          assert(!insideInteractive, `Nested interactive elements: ${file}`);
        }
        for (const child of node.children ?? []) {
          walk(child, insideInteractive || isInteractive);
        }
      };
      walk(tree.body ?? tree);
    } finally {
      parse.window.close();
    }
  } finally {
    dom.window.close();
  }
}
