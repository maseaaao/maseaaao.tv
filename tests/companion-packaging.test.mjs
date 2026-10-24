import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = new URL('../integrations/companion/', import.meta.url);
test('both packaging entrypoints preserve TGZ contents and install payloads from another cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'companion-packaging-'));
  try {
    cpSync(new URL('shared/', source), join(root, 'shared'), {
      recursive: true,
      filter: (name) => !name.endsWith('.exe'),
    });
    for (const [name, helper, entry, extra] of [
      ['system-microphone', 'SystemAudioHelper.exe', 'package-module.mjs', ['Newtonsoft.Json.dll']],
      ['voice-control', 'AudioHelper.exe', 'package.mjs', []],
    ]) {
      const directory = join(root, name);
      mkdirSync(join(directory, 'companion'), { recursive: true });
      for (const file of ['package.json', 'companion/manifest.json', 'companion/HELP.md', entry])
        copyFileSync(new URL(`${name}/${file}`, source), join(directory, file));
      for (const file of [helper, 'NAudio.Core.dll', 'NAudio.Wasapi.dll', ...extra])
        writeFileSync(join(directory, file), Buffer.from('MZ fixture: not executable'));
      writeFileSync(join(directory, 'main.js'), '// fixture, never load\n');
      execFileSync(process.execPath, [join(directory, entry)], { cwd: tmpdir() });
    }
    const checker = join(root, 'shared/test-packages.mjs');
    const output = execFileSync(process.execPath, [checker], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(output.match(/PASS:/g)?.length, 2);
    const directory = join(root, 'voice-control');
    writeFileSync(join(directory, 'main.js'), '// stale archive\n');
    assert.throws(
      () => execFileSync(process.execPath, [checker], { stdio: 'pipe' }),
      /stale archive content/,
    );
    const payload = JSON.parse(readFileSync(join(directory, 'install.json'), 'utf8'));
    assert.equal(payload.path, 'instances.modulesManager.installModuleTar');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
