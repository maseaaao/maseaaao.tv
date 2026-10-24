import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../tooling/local/compile-streamerbot.mjs', import.meta.url);
test('compiler driver stages all Actions and escapes installed references without loading applications', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'streamerbot-compiler-'));
  try {
    const installed = join(root, 'Stream & bot');
    mkdirSync(installed);
    for (const name of [
      'Streamer.bot.Plugin.Interface.dll',
      'Twitch.dll',
      'Newtonsoft.Json.dll',
      'YouTube.dll',
      'Streamer.bot.Test.Wrapper.dll',
      'Streamer.bot.Test.Thunk.dll',
      'Other.dll',
    ])
      writeFileSync(join(installed, name), 'fixture; never load');
    const compiler = join(root, 'dotnet');
    const log = join(root, 'compile.jsonl');
    writeFileSync(
      compiler,
      `#!${process.execPath}
import {appendFileSync, readdirSync, readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const project = process.argv[3];
appendFileSync(process.env.TEST_COMPILER_LOG, JSON.stringify({args:process.argv.slice(2), project:readFileSync(project,'utf8'), sources:readdirSync(dirname(project)).filter(f=>f.endsWith('.cs')).map(f=>readFileSync(join(dirname(project),f),'utf8'))})+'\\n');
process.exit(Number(process.env.TEST_COMPILER_EXIT || 0));
`,
    );
    chmodSync(compiler, 0o755);
    const env = {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      STREAMERBOT_ROOT: installed,
      TEST_COMPILER_LOG: log,
    };
    const output = execFileSync(process.execPath, [script.pathname], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
    });
    assert.equal(output.match(/COMPILED /g)?.length, 9);
    const records = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 9);
    for (const record of records) {
      assert.deepEqual(
        [record.args[0], ...record.args.slice(2)],
        ['build', '--configuration', 'Release'],
      );
      assert.match(record.project, /Stream &amp; bot/);
      assert.match(record.project, /<TargetFramework>net481<\/TargetFramework>/);
      assert.doesNotMatch(record.project, /Wrapper|Thunk|Other\.dll/);
      for (const source of record.sources) {
        if (source.includes('public class CPHInline'))
          assert.match(
            source,
            /using Streamer\.bot\.Plugin\.Interface;[\s\S]*public class CPHInline : CPHInlineBase/,
          );
        assert(!source.startsWith('\uFEFF'));
      }
    }
    assert.throws(() =>
      execFileSync(process.execPath, [script.pathname], {
        env: { ...env, TEST_COMPILER_EXIT: '7' },
        stdio: 'pipe',
      }),
    );
    assert.throws(
      () =>
        execFileSync(process.execPath, [script.pathname], {
          env: { ...env, STREAMERBOT_ROOT: root },
          stdio: 'pipe',
        }),
      /Plugin.Interface.dll is missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
