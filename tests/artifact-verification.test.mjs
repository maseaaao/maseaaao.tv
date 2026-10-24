import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('missing tracked output reports baseline drift without writing acceptance metadata', () => {
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
    const verify = () =>
      spawnSync(process.execPath, [runner], { cwd: directory, encoding: 'utf8' });
    assert.equal(verify().status, 0, 'unchanged artifacts pass');
    writeFileSync(join(directory, 'dist/0.txt'), 'changed artifact');
    assert.notEqual(verify().status, 0, 'modified artifact bytes must fail');
    writeFileSync(join(directory, 'dist/0.txt'), 'artifact');
    writeFileSync(join(directory, 'dist/new.txt'), 'untracked artifact');
    assert.notEqual(verify().status, 0, 'unexpected generated files must fail');
    rmSync(join(directory, 'dist/new.txt'));
    rmSync(join(directory, 'dist/0.txt'));
    const result = spawnSync(process.execPath, [runner], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Generated assets differ/);
    assert.match(result.stderr, /dist\/0\.txt/);
    assert.equal(existsSync(join(directory, '.build-cache')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
