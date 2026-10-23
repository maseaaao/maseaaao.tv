import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('missing tracked output reports baseline drift and still writes a diagnostic manifest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'artifact-contract-'));
  try {
    const source = readFileSync(
      new URL('../tooling/check-generated-artifacts.mjs', import.meta.url),
      'utf8',
    );
    const runner = join(directory, 'verify.mjs');
    // Run the real verifier against a tiny independent Git fixture.
    writeFileSync(
      runner,
      source.replace("resolve(import.meta.dirname, '..')", 'import.meta.dirname'),
    );
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    git('init', '--quiet');
    mkdirSync(join(directory, 'dist'));
    for (let index = 0; index < 40; index++) {
      const file = join(directory, 'dist', `${index}.txt`);
      writeFileSync(file, 'artifact');
    }
    git('add', 'dist');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );
    rmSync(join(directory, 'dist/0.txt'));
    const result = spawnSync(process.execPath, [runner], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Generated assets differ/);
    assert.match(
      readFileSync(join(directory, '.build-cache/verify/artifacts.sha256'), 'utf8'),
      /MISSING.*dist\/0.txt/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
