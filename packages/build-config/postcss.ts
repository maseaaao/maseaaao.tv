import { fileURLToPath } from 'node:url';
import type { AcceptedPlugin, Declaration, Plugin } from 'postcss';
import atImport from 'postcss-import';
import url from 'postcss-url';

const designTokens = fileURLToPath(import.meta.resolve('@maseaaao/design/tokens.css'));

// Provider skins need palette/radius values, not the dock/layout compatibility layer.
// Keep every provider declaration and only trim unreferenced imported design tokens.
function providerDesignTokens(): Plugin {
  return {
    OnceExit(root) {
      const tokens = new Map<string, string>();
      const definitions = new Set<Declaration>();
      root.walkDecls((decl) => {
        if (decl.prop.startsWith('--') && decl.source?.input.file === designTokens) {
          tokens.set(decl.prop, decl.value);
          definitions.add(decl);
        }
      });
      const needed = new Set<string>();
      const pending: string[] = [];
      const reference = (value: string) => {
        for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          const [, name] = match;
          if (name === undefined || needed.has(name)) {
            continue;
          }
          needed.add(name);
          pending.push(name);
        }
      };
      root.walkDecls((decl) => {
        if (!definitions.has(decl)) {
          reference(decl.value);
        }
      });
      while (pending.length) {
        const name = pending.pop();
        if (name !== undefined) {
          reference(tokens.get(name) ?? '');
        }
      }
      for (const decl of definitions) {
        if (!needed.has(decl.prop)) {
          decl.remove();
        }
      }
      root.walkRules((rule) => {
        if (!rule.nodes.length) {
          rule.remove();
        }
      });
    },
    postcssPlugin: 'provider-design-tokens',
  };
}
export function providerPlugins(): AcceptedPlugin[] {
  return [atImport(), url({ maxSize: 500, url: 'inline' }), providerDesignTokens()];
}
