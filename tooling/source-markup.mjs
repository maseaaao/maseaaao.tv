import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { compileTemplate } from 'vue/compiler-sfc';

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
    // the DOM. Vue's source AST retains them, so validate nesting there.
    const { ast } = compileTemplate({ source, filename: file, id: 'source-markup' });
    assert(ast, `Cannot inspect source markup: ${file}`);
    const interactiveTags = new Set(['button', 'input', 'select', 'textarea']);
    function visit(node, insideInteractive = false) {
      const attribute = (name) => node.props?.find((prop) => prop.type === 6 && prop.name === name);
      const interactive =
        node.type === 1 &&
        ((interactiveTags.has(node.tag) &&
          !(node.tag === 'input' && attribute('type')?.value?.content === 'hidden')) ||
          (node.tag === 'a' && Boolean(attribute('href'))));
      assert(!(interactive && insideInteractive), `Nested interactive elements: ${file}`);
      for (const child of node.children ?? []) visit(child, insideInteractive || interactive);
      for (const branch of node.branches ?? []) visit(branch, insideInteractive || interactive);
    }
    visit(ast);
  } finally {
    dom.window.close();
  }
}
