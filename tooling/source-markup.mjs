import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

// Biome owns syntax and accessibility lint. Document-level contracts which
// have no Biome 2.6 equivalent stay with the repository's source checks.
export function checkSourceMarkup(source, file, { fragment = false } = {}) {
  const dom = new JSDOM(source, { virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    if (!fragment) {
      assert.equal(document.doctype?.name.toLowerCase(), 'html', `Missing HTML doctype: ${file}`);
      assert(document.documentElement.lang.trim(), `Missing document language: ${file}`);
      assert(
        document.querySelector('head > title')?.textContent.trim(),
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
      const interactive = (node) =>
        node.tagName === 'MARKUP-BUTTON' ||
        (node.tagName === 'MARKUP-A' && Boolean(node.getAttribute('href'))) ||
        (node.tagName === 'INPUT' && node.getAttribute('type') !== 'hidden');
      const walk = (node, insideInteractive = false) => {
        if (node.attributes && interactive(node)) {
          assert(!insideInteractive, `Nested interactive elements: ${file}`);
          insideInteractive = true;
        }
        for (const child of node.children ?? []) walk(child, insideInteractive);
      };
      walk(tree.body ?? tree);
    } finally {
      parse.window.close();
    }
  } finally {
    dom.window.close();
  }
}
