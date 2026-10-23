import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('Companion cross-compilation needs no Windows compiler or application installation', () => {
  for (const [module, helper] of [
    ['system-microphone', 'SystemAudioHelper'],
    ['voice-control', 'AudioHelper'],
  ]) {
    const directory = `integrations/companion/${module}`;
    const build = read(`${directory}/build.mjs`);
    assert.match(build, /execFileSync\(\s*'dotnet'/);
    assert.doesNotMatch(build, /powershell|WINDIR|csc\.exe/);
    const project = read(`${directory}/${helper}.csproj`);
    assert.match(project, /<TargetFramework>net481<\/TargetFramework>/);
    assert.match(project, /<PlatformTarget>x64<\/PlatformTarget>/);
    assert.match(project, /Microsoft.NETFramework.ReferenceAssemblies/);
    assert.match(project, /RestoreLockedMode/);
    const lock = JSON.parse(read(`${directory}/packages.lock.json`));
    const packages = lock.dependencies['.NETFramework,Version=v4.8.1'];
    for (const [name, version] of [
      ['Microsoft.NETFramework.ReferenceAssemblies', '1.0.3'],
      ['NAudio.Core', '2.2.1'],
      ['NAudio.Wasapi', '2.2.1'],
      ...(module === 'system-microphone' ? [['Newtonsoft.Json', '13.0.3']] : []),
    ]) {
      assert.equal(packages[name].resolved, version);
      assert(packages[name].contentHash, `${name} must have a pinned content hash`);
    }
  }
});

test('development scripts do not restore removed Windows tooling', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:ui'], 'pnpm --filter ./tooling/ui-catalog run test');
  assert(!pkg.scripts['prepare:companion-libs']);
  for (const file of [
    'tooling/patch-storybook-windows.mjs',
    'tooling/prepare-companion-libs.ps1',
    'integrations/companion/shared/build-helper.ps1',
    'tooling/local/compile-streamerbot.ps1',
  ])
    assert(!existsSync(resolve(root, file)), file);
});
