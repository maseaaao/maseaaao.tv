import atImport from 'postcss-import';
import url from 'postcss-url';
import { fileURLToPath } from 'node:url';

const designTokens = fileURLToPath(import.meta.resolve('@maseaaao/design/tokens.css'));

// Provider skins need palette/radius values, not the dock/layout compatibility layer.
// Keep every provider declaration and only trim unreferenced imported design tokens.
function providerDesignTokens() {
  return {
    postcssPlugin: 'provider-design-tokens',
    OnceExit(root) {
      const tokens = new Map();
      const definitions = new Set();
      root.walkDecls((decl) => {
        if (decl.prop.startsWith('--') && decl.source?.input.file === designTokens) {
          tokens.set(decl.prop, decl.value);
          definitions.add(decl);
        }
      });
      const needed = new Set();
      const pending = [];
      const reference = (value) => {
        for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (needed.has(match[1])) continue;
          needed.add(match[1]);
          pending.push(match[1]);
        }
      };
      root.walkDecls((decl) => {
        if (!definitions.has(decl)) reference(decl.value);
      });
      while (pending.length) reference(tokens.get(pending.pop()) ?? '');
      for (const decl of definitions) if (!needed.has(decl.prop)) decl.remove();
      root.walkRules((rule) => {
        if (!rule.nodes.length) rule.remove();
      });
    },
  };
}
export function providerPlugins() {
  return [atImport(), url({ url: 'inline', maxSize: 200 }), providerDesignTokens()];
}
