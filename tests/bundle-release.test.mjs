import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const cli = new URL('../tooling/bundle-release.mjs', import.meta.url);
test('manual ZIP preserves hidden files, exact targets and licenses without an updater', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-test-'));
  const put = (name, data) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), data);
  };
  try {
    put('LICENSE', 'repository license');
    put('CHANGELOG.md', '## 1.0.0\n\nTest release.\n');
    put('docs/windows-releases.md', 'Install manually.');
    put('app/package.json', '{"version":"1.0.0"}');
    put('app/dist/.well-known/example', 'hidden');
    put('app/dist/index.html', 'built');
    put('app/LICENSE', 'product license');
    put('packages/design/licenses/Unbounded-OFL.txt', 'font license');
    put(
      'tooling/release-products.json',
      JSON.stringify({
        schemaVersion: 2,
        products: [
          {
            id: 'example',
            path: 'app',
            files: [
              { source: 'app/dist', target: '.' },
              { source: 'app/package.json', target: 'metadata/version.json' },
            ],
          },
        ],
      }),
    );
    const run = (tag = 'v1.0.0') =>
      execFileSync(process.execPath, [cli.pathname, tag, '--root', root], {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe',
      });
    run();
    const archive = join(root, 'build/release/v1.0.0/maseaaao-1.0.0.zip');
    const listing = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    for (const file of [
      'example/.well-known/example',
      'example/metadata/version.json',
      'example/LICENSE',
      'example/licenses/Unbounded-OFL.txt',
      'LICENSE',
      'INSTALL.md',
    ])
      assert(listing.split('\n').includes(file), file);
    assert.doesNotMatch(listing, /updater/);
    assert.equal(
      execFileSync('unzip', ['-p', archive, 'example/index.html'], { encoding: 'utf8' }),
      'built',
    );
    assert.equal(
      execFileSync('unzip', ['-p', archive, 'LICENSE'], { encoding: 'utf8' }),
      'repository license',
    );
    assert.equal(
      execFileSync('unzip', ['-p', archive, 'example/LICENSE'], { encoding: 'utf8' }),
      'product license',
    );
    const first = readFileSync(archive);
    run();
    assert.deepEqual(readFileSync(archive), first);
    assert.throws(() => run('v01.0.0'));
    const catalog = JSON.parse(readFileSync(join(root, 'tooling/release-products.json'), 'utf8'));
    for (const target of ['INDEX.html', '../escape', 'C:/escape']) {
      catalog.products[0].files.push({ source: 'app/package.json', target });
      put('tooling/release-products.json', JSON.stringify(catalog));
      assert.throws(() => run(), target);
      catalog.products[0].files.pop();
    }
    put('tooling/release-products.json', JSON.stringify(catalog));
    symlinkSync(join(root, 'app/package.json'), join(root, 'app/dist/link'));
    assert.throws(() => run(), 'symlinks are not release payloads');
    rmSync(join(root, 'app/dist/link'));
    rmSync(join(root, 'app/dist'), { recursive: true });
    assert.throws(() => run());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
