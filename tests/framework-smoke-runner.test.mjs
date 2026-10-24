import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL(
  '../apps/stream-info/tests/csharp/run-framework-category-smoke.mjs',
  import.meta.url,
);
test('Framework runner stages sources, preserves compiler flags and exit codes, and cleans scratch', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'framework-runner-'));
  try {
    const framework = join(root, 'Microsoft.NET/Framework64/v4.0.30319');
    mkdirSync(framework, { recursive: true });
    const compiler = join(framework, 'csc.exe');
    const log = join(root, 'compile.jsonl');
    writeFileSync(
      compiler,
      `#!${process.execPath}
const {appendFileSync, readdirSync, writeFileSync} = require('node:fs');
appendFileSync(process.env.TEST_FRAMEWORK_LOG, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),files:readdirSync('.')})+'\\n');
if(process.env.TEST_COMPILER_EXIT) process.exit(Number(process.env.TEST_COMPILER_EXIT));
if(process.argv.includes('/out:smoke.exe')) writeFileSync('smoke.exe', ${JSON.stringify(`#!${process.execPath}
console.log('SMOKE fixture executed');
`)}, {mode:0o755});
process.stdout.write(Buffer.from([0x92,0xa5,0xe1,0xe2]));
`,
    );
    chmodSync(compiler, 0o755);
    const env = { ...process.env, WINDIR: root, TEST_FRAMEWORK_LOG: log };
    const result = execFileSync(process.execPath, [script.pathname], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
    });
    assert.match(result, /Тест/);
    // debugging
    const records = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 2);
    assert(records[0].args.includes('/target:library'));
    assert(records[1].args.includes('/r:backend.dll'));
    for (const record of records) {
      assert(record.args.includes('/r:' + join(framework, 'System.Net.Http.dll')));
      assert(record.files.includes('FrameworkCategorySmoke.cs'));
      assert(record.files.includes('category-search-transport.cs'));
      assert.equal(existsSync(record.cwd), false, 'scratch must be removed');
    }
    assert.throws(
      () =>
        execFileSync(process.execPath, [script.pathname], {
          env: { ...env, TEST_COMPILER_EXIT: '7' },
          stdio: 'pipe',
        }),
      (error) => error.status === 7,
    );
    const failed = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1));
    assert.equal(existsSync(failed.cwd), false, 'failed compilation scratch must be removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
