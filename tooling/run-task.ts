// Turbo handles caching; this launcher adds runtime tools to its cache identity.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, rmdirSync, rmSync } from 'node:fs';
import { release } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Glob } from 'bun';
import { chromium } from 'playwright-core';
import config from '../turbo.json';

const DRY_RUN_GRAPH_HELP_RE = /^--(?:dry(?:-run)?|graph|help|version)(?:=|$)/;

const root = resolve(import.meta.dirname, '..');
function cleanOutputFile(file: string): void {
  const path = resolve(root, file);
  if (lstatSync(path).isDirectory()) {
    try {
      rmdirSync(path);
    } catch (error) {
      // An excluded output may still belong to another task.
      if (!(error instanceof Error && 'code' in error) || error.code !== 'ENOTEMPTY') {
        throw error;
      }
    }
  } else {
    rmSync(path, { force: true });
  }
}

// Turbo overlays cached files; remove owned outputs so retired files cannot survive.
function cleanOutputs(name: string) {
  const entry =
    Object.entries(config.tasks).find(([key]) => key === name) ??
    Object.entries(config.tasks).find(([key]) => key === name.split('#').at(-1));
  if (!entry) {
    return;
  }
  const [, task] = entry;
  if ('dependsOn' in task) {
    for (const dependency of task.dependsOn) {
      cleanOutputs(dependency);
    }
  }
  const outputs = task.outputs.map((pattern) => pattern.replace('$TURBO_ROOT$/', ''));
  const excluded = outputs
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => new Glob(pattern.slice(1)));
  for (const pattern of outputs.filter((output) => !output.startsWith('!'))) {
    const files = [...new Glob(pattern).scanSync({ cwd: root, dot: true, onlyFiles: false })]
      .filter((file) => !excluded.some((glob) => glob.match(file)))
      .sort((left, right) => right.length - left.length);
    for (const file of files) {
      cleanOutputFile(file);
    }
  }
}

function version(command: string, argsLocal: string[]) {
  const result = spawnSync(command, argsLocal, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}

function browserFingerprint(executable: string) {
  if (!existsSync(executable)) {
    return 'unavailable';
  }
  // chrome.exe --version opens a GUI on Windows; hash binaries without launching them.
  const hash = createHash('sha256').update(readFileSync(executable));
  const dll = resolve(executable, '..', 'chrome.dll');
  if (process.platform === 'win32' && existsSync(dll)) {
    hash.update(readFileSync(dll));
  }
  return hash.digest('hex');
}

const browser = process.env.CHROME_BIN || process.env.CHROME_PATH || chromium.executablePath();
const toolchain = JSON.stringify({
  arch: process.arch,
  bun: process.versions.bun,
  chromium: browserFingerprint(browser),
  dotnet: version('dotnet', ['--version']),
  os: existsSync('/etc/os-release') ? readFileSync('/etc/os-release', 'utf8') : release(),
  platform: process.platform,
  tar: version('tar', ['--version']),
});
const args = process.argv.slice(2);
const readOnly = args.some((arg) => DRY_RUN_GRAPH_HELP_RE.test(arg) || arg === '-h');
if (!readOnly) {
  for (const name of args) {
    cleanOutputs(name);
  }
}
const result = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve('turbo')), 'run', ...args, '--cache=local:rw'],
  {
    cwd: root,
    env: { ...process.env, TASK_CACHE_TOOLCHAIN: toolchain },
    stdio: 'inherit',
  },
);
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
