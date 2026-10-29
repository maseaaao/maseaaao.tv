// Read-only checks of built archives; never loads helpers or modules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP_RE = /\/$/;
const NEWLINE_RE = /\r?\n/;

interface ModuleManifest {
  id: string;
  runtime: { type: string; entrypoint: string };
  version: string;
}
interface PackageMetadata {
  name: string;
  type: string;
  version: string;
}
interface InstallRequest {
  input: { tarBuffer: string };
  path: string;
}

const root = fileURLToPath(new URL('../../../dist/companion/', import.meta.url));
const modules: [string, string, string, string[]][] = [
  ['system-microphone', 'SystemAudioHelper.exe', 'request.json', ['Newtonsoft.Json.dll']],
  ['voice-control', 'AudioHelper.exe', 'install.json', []],
];
for (const [directory, helper, request, extra] of modules) {
  const module = join(root, directory);
  const json = <T>(name: string): T => JSON.parse(readFileSync(join(module, name), 'utf8'));
  const manifest = json<ModuleManifest>('companion/manifest.json');
  const { id, version } = manifest;
  assert.equal(
    json<PackageMetadata>('package.json').version,
    version,
    'package/manifest version mismatch',
  );
  assert.equal(manifest.runtime.type, 'node22');
  assert.equal(manifest.runtime.entrypoint, '../main.js');
  const archive = join(module, `${id}-${version}.tgz`);
  const tar = (args: string[]) => execFileSync('tar', args, { maxBuffer: 64 * 1024 * 1024 });
  const names = tar(['-tzf', archive])
    .toString('utf8')
    .trim()
    .split(NEWLINE_RE)
    .map((name) => name.replace(MAP_RE, ''));
  const files = [
    'main.js',
    helper,
    'NAudio.Core.dll',
    'NAudio.Wasapi.dll',
    'companion/manifest.json',
    'companion/HELP.md',
    ...extra,
  ];
  assert.equal(names.length, new Set(names).size, 'duplicate archive entries');
  assert.deepEqual(
    new Set(names),
    new Set([id, `${id}/package.json`, ...files.map((name) => `${id}/${name}`)]),
  );
  for (const name of names) {
    assert(!(posix.isAbsolute(name) || name.split('/').includes('..')), 'unsafe path');
  }
  for (const entry of tar(['-tvzf', archive]).toString('utf8').trim().split(NEWLINE_RE)) {
    assert(['-', 'd'].includes(entry[0]), 'archive links are forbidden');
  }
  for (const name of files) {
    const data = tar(['-xOzf', archive, `${id}/${name}`]);
    assert.deepEqual(data, readFileSync(join(module, name)), `stale archive content: ${name}`);
    if (/\.(exe|dll)$/.test(name)) {
      assert.equal(data.subarray(0, 2).toString(), 'MZ', `invalid Windows binary: ${name}`);
    }
  }
  const packed: PackageMetadata = JSON.parse(
    tar(['-xOzf', archive, `${id}/package.json`]).toString('utf8'),
  );
  assert.equal(packed.name, id);
  assert.equal(packed.version, version);
  assert.equal(packed.type, 'module');
  assert.deepEqual(
    tar(['-xOzf', archive, `${id}/package.json`]),
    readFileSync(join(module, 'package.json')),
    'stale archive content: package.json',
  );
  const payload = json<InstallRequest>(request);
  assert.equal(payload.path, 'instances.modulesManager.installModuleTar');
  assert.equal(payload.input.tarBuffer, readFileSync(archive).toString('base64'));
  console.log(
    `PASS: ${id}-${version}.tgz: ${files.length + 1} files; exact source bytes, versions, entrypoint, PE headers, safe paths, install payload`,
  );
  console.log(`SHA256 ${createHash('sha256').update(readFileSync(archive)).digest('hex')}`);
}
