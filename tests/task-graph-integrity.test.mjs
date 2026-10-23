import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const config = JSON.parse(read('turbo.json'));

const packageDirectories = [
  'apps/website',
  'apps/stream-info',
  'apps/tuna-widget',
  'apps/obs-widgets',
  'artwork',
  'packages/ui',
  'packages/design',
  'packages/build-config',
  'tooling/ui-catalog',
  'tooling/ui-portability',
  'tooling/static-fixtures',
  'integrations/companion/system-microphone',
  'integrations/companion/voice-control',
];

const implemented = new Set();
for (const directory of packageDirectories) {
  const manifest = JSON.parse(read(`${directory}/package.json`));
  for (const task of Object.keys(manifest.scripts ?? {}))
    implemented.add(`${manifest.name}#${task}`);
}

test('every task in the graph is implemented by a package', () => {
  // A task that no package script implements runs as <NONEXISTENT>: it never
  // executes, never caches and only adds nodes to the graph.
  for (const name of Object.keys(config.tasks)) {
    if (name.includes('#')) {
      assert.ok(
        implemented.has(name),
        `${name} is declared in turbo.json but no package implements it`,
      );
      continue;
    }
    const owners = [...implemented].filter((entry) => entry.endsWith('#' + name));
    assert.ok(
      owners.length > 0,
      `task ${name} is not implemented by any package: it would run as <NONEXISTENT>`,
    );
  }
});

test('every dependency of a task exists in the graph', () => {
  const declared = new Set(Object.keys(config.tasks));
  for (const [name, task] of Object.entries(config.tasks)) {
    for (const dependency of task.dependsOn ?? []) {
      if (dependency.startsWith('^')) continue; // dependency of a dependency
      if (dependency.includes('#')) {
        const owner = dependency.split('#')[0];
        assert.ok(
          declared.has(dependency) ||
            implemented.has(dependency) ||
            existsSync(resolve(root, owner)),
          `${name} depends on unknown task ${dependency}`,
        );
        continue;
      }
      assert.ok(declared.has(dependency), `${name} depends on unknown task ${dependency}`);
    }
  }
});
