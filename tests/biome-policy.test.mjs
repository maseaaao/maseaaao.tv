import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkSourceMarkup } from '../tooling/source-markup.mjs';

const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, 'node_modules/@biomejs/biome/bin/biome');
let sequence = 0;
function lint(source, extension = 'ts', directory = 'packages/ui') {
  const path = `${directory}/BiomePolicy${process.pid}_${sequence++}.${extension}`;
  const target = resolve(root, path);
  writeFileSync(target, source, { flag: 'wx' });
  try {
    const result = spawnSync(
      process.execPath,
      [cli, 'lint', '--reporter=json', '--max-diagnostics=none', path],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      },
    );
    assert.ifError(result.error);
    assert(result.stdout, result.stderr);
    const report = JSON.parse(result.stdout);
    assert(
      !report.diagnostics.some(
        (diagnostic) => diagnostic.severity === 'info' && diagnostic.category === 'plugin',
      ),
      result.stdout,
    );
    return { ...report, status: result.status };
  } finally {
    unlinkSync(target);
  }
}
const has = (result, category) =>
  result.diagnostics.some((diagnostic) => diagnostic.category === category);

test('semantic tokens remain allowed in product sources', () => {
  assert.equal(
    lint(
      'export function token(): string { return "color-mix(in srgb, var(--color-surface) 50%, transparent)"; }',
    ).status,
    0,
  );
});
test('type assertions are rejected in product TypeScript', () => {
  assert(has(lint('export const value = {} as string;'), 'plugin'));
  assert(has(lint('export const value = <string>{};'), 'plugin'));
});
test('strict TS and workspace import boundaries remain enforced', () => {
  assert(has(lint('export const value: any = 1;'), 'lint/suspicious/noExplicitAny'));
  assert(
    has(
      lint('export const value = document.querySelector("div")!;'),
      'lint/style/noNonNullAssertion',
    ),
  );
  assert(
    has(
      lint('import value from "@maseaaao/website/src/private"; console.log(value);'),
      'lint/style/noRestrictedImports',
    ),
  );
  assert(
    has(
      lint('export function handle() { return missingBinding; }'),
      'lint/correctness/noUndeclaredVariables',
    ),
  );
});
test('HTML and CSS lint remain active', () => {
  assert(
    has(
      lint(
        '<!doctype html><html lang="ru"><head><title>Test</title></head><body><img src="x.png"></body></html>',
        'html',
      ),
      'lint/a11y/useAltText',
    ),
  );
  assert(has(lint('p { unknown-property: 1; }', 'css'), 'lint/correctness/noUnknownProperty'));
});
test('document contracts reject missing metadata and nested controls but accept provider fragments', () => {
  const valid =
    '<!doctype html><html lang="ru"><head><title>Тест</title></head><body><button>Тест</button></body></html>';
  checkSourceMarkup(valid, 'valid.html');
  for (const source of [
    valid.replace('<!doctype html>', ''),
    valid.replace('lang="ru"', ''),
    valid.replace('<title>Тест</title>', ''),
    valid.replace('<button>Тест</button>', '<button><input></button>'),
    valid.replace('<button>Тест</button>', '<button><button>Тест</button></button>'),
    valid.replace('<button>Тест</button>', '<a href="/a"><a href="/b">Тест</a></a>'),
  ]) {
    assert.throws(() => checkSourceMarkup(source, 'invalid.html'));
  }
  checkSourceMarkup('<span>{message}</span>', 'provider.html', { fragment: true });
});
test('Promise mistakes and cross-runtime globals are rejected', () => {
  assert(has(lint('Promise.resolve(1);'), 'lint/nursery/noFloatingPromises'));
  assert(has(lint('console.log(window.location);', 'mjs'), 'lint/style/noRestrictedGlobals'));
  assert(
    has(
      lint('console.log(process.pid);', 'js', 'apps/tuna-widget/src'),
      'lint/style/noRestrictedGlobals',
    ),
  );
});
