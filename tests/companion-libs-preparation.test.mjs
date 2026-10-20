import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../tooling/prepare-companion-libs.ps1', import.meta.url));
const packages = ['naudio.core', 'naudio.wasapi', 'newtonsoft.json'];
const dlls = ['NAudio.Core.dll', 'NAudio.Wasapi.dll', 'Newtonsoft.Json.dll'];
// This script is a Windows build step; companion-build runs these tests explicitly.
const windowsTest = process.platform === 'win32' ? test : test.skip;

function runPreparation(t, scenario) {
  const root = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'companion-libs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'tooling'));
  const lib = path.join(root, 'integrations/companion/shared/lib');
  mkdirSync(lib, { recursive: true });
  copyFileSync(script, path.join(root, 'tooling/prepare-companion-libs.ps1'));
  for (const name of [...packages.map((id) => `${id}.nupkg`), ...dlls]) {
    writeFileSync(path.join(lib, name), `last-good:${name}`);
  }
  const harness = path.join(root, 'run.ps1');
  writeFileSync(
    harness,
    `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
[Console]::OutputEncoding=New-Object Text.UTF8Encoding
$global:attempts=@{}
$global:entryNames=@{
    'naudio.core'='lib/netstandard2.0/NAudio.Core.dll'
    'naudio.wasapi'='lib/netstandard2.0/NAudio.Wasapi.dll'
    'newtonsoft.json'='lib/net45/Newtonsoft.Json.dll'
}
function Write-Fixture($OutFile,$EntryName,$Contents) {
    if(Test-Path $OutFile) {Remove-Item $OutFile -Force}
    $zip=[IO.Compression.ZipFile]::Open($OutFile,[IO.Compression.ZipArchiveMode]::Create)
    try {
        $writer=New-Object IO.StreamWriter($zip.CreateEntry($EntryName).Open())
        try {$writer.Write($Contents)} finally {$writer.Dispose()}
    } finally {$zip.Dispose()}
}
$lib=Join-Path $PSScriptRoot 'integrations/companion/shared/lib'
foreach($id in $global:entryNames.Keys) {
    Write-Fixture (Join-Path $lib ($id+'.nupkg')) $global:entryNames[$id] ('last-good:'+ [IO.Path]::GetFileName($global:entryNames[$id]))
}
$previous=Join-Path $PSScriptRoot 'previous'
New-Item -ItemType Directory -Path $previous | Out-Null
Get-ChildItem $lib -File | Copy-Item -Destination $previous
function Invoke-WebRequest {
    param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing)
    if($Uri -notmatch '^https://api[.]nuget[.]org/v3-flatcontainer/(naudio[.]core|naudio[.]wasapi|newtonsoft[.]json)/(2[.]2[.]1|13[.]0[.]3)/') {throw 'Unexpected source or pin'}
    $id=$Matches[1]
    $version=if($id -eq 'newtonsoft.json'){'13.0.3'}else{'2.2.1'}
    if($Uri -ne "https://api.nuget.org/v3-flatcontainer/$id/$version/$id.$version.nupkg") {throw 'Unexpected source or pin'}
    $global:attempts[$id]++
    $attempt=$global:attempts[$id]
    $scenario='${scenario}'
    if(($scenario -eq 'partial-failure' -and $id -eq 'naudio.wasapi') -or ($scenario -eq 'retry-throw' -and $id -eq 'naudio.core' -and $attempt -eq 1)) {
        [IO.File]::WriteAllText($OutFile,'PK interrupted transfer')
        throw 'Injected interrupted transfer'
    }
    if(($scenario -eq 'invalid-failure' -and $id -eq 'naudio.wasapi') -or ($scenario -eq 'retry-invalid' -and $id -eq 'naudio.core' -and $attempt -eq 1)) {
        [IO.File]::WriteAllText($OutFile,'PK invalid archive')
        return
    }
    $entryName=$global:entryNames[$id]
    if($scenario -eq 'missing-entry' -and $id -eq 'naudio.wasapi') {$entryName='wrong/path.dll'}
    Write-Fixture $OutFile $entryName ('new-library:'+$id)
}
try {
    if('${scenario}' -eq 'fresh') {Get-ChildItem $lib -File | Remove-Item -Force}
    & (Join-Path $PSScriptRoot 'tooling/prepare-companion-libs.ps1')
    foreach($id in $global:entryNames.Keys) {
        $zip=[IO.Compression.ZipFile]::OpenRead((Join-Path $lib ($id+'.nupkg')))
        try {
            $reader=New-Object IO.StreamReader($zip.GetEntry($global:entryNames[$id]).Open())
            try {
                if($reader.ReadToEnd() -ne ('new-library:'+$id)){throw 'Invalid published cache'}
            } finally {$reader.Dispose()}
        } finally {$zip.Dispose()}
    }
    $code=0
} catch {
    Write-Output $_
    $code=1
} finally {
    $global:attempts | ConvertTo-Json -Compress | Set-Content (Join-Path $PSScriptRoot 'attempts.json')
    @(Get-ChildItem (Join-Path $PSScriptRoot 'integrations/companion/shared/lib') -Force | Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress | Set-Content (Join-Path $PSScriptRoot 'files.json')
}
exit $code
`,
  );
  const result = spawnSync(
    process.env.COMPANION_TEST_POWERSHELL || 'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.ifError(result.error);
  const attempts = JSON.parse(
    readFileSync(path.join(root, 'attempts.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  const files = JSON.parse(
    readFileSync(path.join(root, 'files.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  return { result, attempts, files, lib, root };
}

function assertPreserved({ lib, files, root }) {
  const names = [...packages.map((id) => `${id}.nupkg`), ...dlls];
  for (const name of names) {
    assert.deepEqual(
      readFileSync(path.join(lib, name)),
      readFileSync(path.join(root, 'previous', name)),
      `must preserve ${name}`,
    );
  }
  assert.deepEqual(files.sort(), names.sort(), 'must remove all staging files');
}

windowsTest('interrupted later download preserves every previous cache and pinned DLL', (t) => {
  const state = runPreparation(t, 'partial-failure');
  assert.equal(state.result.status, 1, state.result.stdout + state.result.stderr);
  assert.match(state.result.stdout, /Injected interrupted transfer/);
  assertPreserved(state);
  assert.equal(state.attempts['naudio.wasapi'], 3, 'bounded retry exhaustion');
});

for (const scenario of ['invalid-failure', 'missing-entry']) {
  windowsTest(`${scenario}: rejects the package without publishing any cache or DLL`, (t) => {
    const state = runPreparation(t, scenario);
    assert.equal(state.result.status, 1, state.result.stdout + state.result.stderr);
    if (scenario === 'missing-entry')
      assert.match(state.result.stdout, /Missing library: lib\/netstandard2.0\/NAudio.Wasapi.dll/);
    assert.equal(state.attempts['naudio.wasapi'], 3);
    assertPreserved(state);
  });
}

for (const scenario of ['success', 'fresh', 'retry-throw', 'retry-invalid']) {
  windowsTest(`${scenario}: publishes validated libraries with bounded download attempts`, (t) => {
    const state = runPreparation(t, scenario);
    assert.equal(state.result.status, 0, state.result.stdout + state.result.stderr);
    assert.equal(state.attempts['naudio.core'], scenario.startsWith('retry-') ? 2 : 1);
    assert.equal(state.attempts['naudio.wasapi'], 1);
    assert.equal(state.attempts['newtonsoft.json'], 1);
    for (let index = 0; index < dlls.length; index++) {
      assert.equal(
        readFileSync(path.join(state.lib, dlls[index]), 'utf8'),
        `new-library:${packages[index]}`,
      );
    }
    assert.equal(state.files.length, 6, 'no staging artifacts');
  });
}
