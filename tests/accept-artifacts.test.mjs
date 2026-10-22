import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// The raster baseline is bound to one operating system: Chromium rasterizes
// text differently on Windows and Linux. Accepting a re-rendered baseline must
// be a reviewed operation, and an incomplete artifact set must never leave the
// tree half updated.
const source = readFileSync(new URL('../tooling/accept-artifacts.mjs', import.meta.url), 'utf8');

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'accept-artifacts-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet');
  mkdirSync(join(directory, 'dist'), { recursive: true });
  writeFileSync(join(directory, 'dist', 'index.html'), 'committed');
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
  return directory;
}

function runner(directory) {
  const path = join(directory, 'accept.mjs');
  writeFileSync(
    path,
    source
      .replace("resolve(import.meta.dirname, '..')", 'import.meta.dirname')
      .replace("fileURLToPath(new URL('../', import.meta.url))", "import.meta.dirname + '/'")
      .replace('process.argv[2] ??', 'process.argv[2] ??'),
  );
  return path;
}

test('an incomplete artifact set leaves the tracked tree untouched', () => {
  const directory = fixture();
  try {
    const incoming = join(directory, 'incoming');
    mkdirSync(incoming, { recursive: true });
    // The set is incomplete: the tracked file is absent from the artifact.
    const result = spawnSync(process.execPath, [runner(directory), incoming], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing/i);
    assert.equal(readFileSync(join(directory, 'dist', 'index.html'), 'utf8'), 'committed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a complete artifact set updates the tracked file', () => {
  const directory = fixture();
  try {
    const incoming = join(directory, 'incoming');
    mkdirSync(join(incoming, 'dist'), { recursive: true });
    writeFileSync(join(incoming, 'dist', 'index.html'), 're-rendered on linux');
    const result = spawnSync(process.execPath, [runner(directory), incoming], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(directory, 'dist', 'index.html'), 'utf8'),
      're-rendered on linux',
    );
    assert.match(result.stdout, /Accepted raster baseline/);
    // The accepted change is an ordinary working tree change to review.
    const status = spawnSync('git', ['status', '--porcelain=v1'], {
      cwd: directory,
      encoding: 'utf8',
    }).stdout;
    assert.match(status, /dist\/index\.html/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an identical artifact set reports no change', () => {
  const directory = fixture();
  try {
    const incoming = join(directory, 'incoming');
    mkdirSync(join(incoming, 'dist'), { recursive: true });
    writeFileSync(join(incoming, 'dist', 'index.html'), 'committed');
    const result = spawnSync(process.execPath, [runner(directory), incoming], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 updated/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
