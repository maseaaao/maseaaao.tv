import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'python-runner-'));
  try {
    mkdirSync(join(root, 'tooling'));
    copyFileSync(
      new URL('../tooling/run-python.mjs', import.meta.url),
      join(root, 'tooling/run-python.mjs'),
    );
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const fake = (path, label) => {
      writeFileSync(
        path,
        `#!${process.execPath}\nconsole.log(JSON.stringify({ interpreter: ${JSON.stringify(label)}, args: process.argv.slice(2), cwd: process.cwd() })); process.exit(Number(process.env.TEST_PYTHON_EXIT || 0));\n`,
      );
      chmodSync(path, 0o755);
    };
    fake(join(bin, 'python'), 'system');
    run({ root, fake, env: { ...process.env, PATH: bin } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function invoke(root, env) {
  return spawnSync(
    process.execPath,
    [join(root, 'tooling/run-python.mjs'), '-m', 'example', 'an argument with spaces'],
    { encoding: 'utf8', cwd: tmpdir(), env },
  );
}

test('Python scripts use the checkout venv without shell activation and preserve arguments and cwd', () => {
  fixture(({ root, fake, env }) => {
    mkdirSync(join(root, '.runtime/venv/bin'), { recursive: true });
    fake(join(root, '.runtime/venv/bin/python'), 'venv');
    const result = invoke(root, env);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      interpreter: 'venv',
      args: ['-m', 'example', 'an argument with spaces'],
      cwd: root,
    });
  });
});

test('Python scripts retain the PATH interpreter in CI without a local venv', () => {
  fixture(({ root, env }) => {
    const result = invoke(root, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).interpreter, 'system');
  });
});

test('Python failures propagate instead of reporting success', () => {
  fixture(({ root, env }) => {
    assert.equal(invoke(root, { ...env, TEST_PYTHON_EXIT: '7' }).status, 7);
  });
});
