import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const repository = resolve(import.meta.dirname, '..');

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'release-pipeline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    mkdirSync(resolve(root, name, '..'), { recursive: true });
    writeFileSync(resolve(root, name), value);
  };
  for (const name of [
    'tooling/release-product.mjs',
    'tooling/package-release.py',
    'tooling/windows/release_bundle.py',
  ]) {
    mkdirSync(resolve(root, name, '..'), { recursive: true });
    cpSync(resolve(repository, name), resolve(root, name));
  }
  const product = {
    id: 'demo',
    tagPrefix: 'demo-v',
    path: 'app',
    files: [{ source: 'app/dist', target: '.' }],
    build: 'printf built > app/dist/index.html',
    test: 'test "$(cat app/dist/index.html)" = built',
    dotnet: false,
    browser: false,
    requires: {},
    activation: 'Manual only',
  };
  put(
    'tooling/release-products.json',
    JSON.stringify({ schemaVersion: 1, repository: 'owner/repo', products: [product] }),
  );
  put('app/package.json', JSON.stringify({ version: '1.2.3' }));
  put('app/CHANGELOG.md', '## 1.2.3\n\nA real change.\n');
  put('app/dist/index.html', 'stale');
  put('packages/design/licenses/Unbounded-OFL.txt', 'license');
  put('docs/windows-releases.md', 'Manual updater');
  const run = (...args) =>
    spawnSync(args[0], args.slice(1), {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${resolve(root, 'bin')}:${process.env.PATH}`,
        GH_REPO: 'owner/repo',
        GITHUB_OUTPUT: '',
      },
    });
  for (const args of [
    ['git', 'init', '-q'],
    ['git', 'add', '.'],
    [
      'git',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
    ['git', 'tag', 'demo-v1.2.3'],
  ]) {
    assert.equal(run(...args).status, 0);
  }
  const sha = run('git', 'rev-parse', 'HEAD').stdout.trim();
  const cli = (...args) => run('node', 'tooling/release-product.mjs', ...args);
  return { root, put, run, cli, sha, product };
}

test('pure plan resolves an existing tag to SHA and emits dependency requirements without building', (t) => {
  const f = fixture(t);
  const result = f.cli('--plan', 'demo-v1.2.3');
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan, {
    tag: 'demo-v1.2.3',
    sha: f.sha,
    product: 'demo',
    dotnet: false,
    browser: false,
    pythonRequirements: '',
  });
  assert.equal(readFileSync(resolve(f.root, 'app/dist/index.html'), 'utf8'), 'stale');
});

test('build runs before dist-dependent tests and never installs runtime prerequisites', (t) => {
  const f = fixture(t);
  // Requirements are installed by the unprivileged workflow, never by this runner.
  f.product.browser = true;
  f.product.pythonRequirements = 'missing-fonts.txt';
  f.put(
    'tooling/release-products.json',
    JSON.stringify({ schemaVersion: 1, repository: 'owner/repo', products: [f.product] }),
  );
  const result = f.cli('--build', 'demo-v1.2.3');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(resolve(f.root, 'app/dist/index.html'), 'utf8'), 'built');
});

test('plan rejects branches, leading zero versions, version drift and missing changelog before build', (t) => {
  const f = fixture(t);
  f.run('git', 'tag', '-d', 'demo-v1.2.3');
  f.run('git', 'branch', 'demo-v1.2.3');
  assert.notEqual(f.cli('--plan', 'demo-v1.2.3').status, 0);
  f.run('git', 'tag', 'demo-v1.2.3');
  assert.notEqual(f.cli('--plan', 'demo-v01.2.3').status, 0);
  f.put('app/package.json', JSON.stringify({ version: '1.2.4' }));
  assert.notEqual(f.cli('--plan', 'demo-v1.2.3').status, 0);
  f.put('app/package.json', JSON.stringify({ version: '1.2.3' }));
  f.put('app/CHANGELOG.md', '## 9.9.9\nOther release\n');
  assert.notEqual(f.cli('--plan', 'demo-v1.2.3').status, 0);
  assert.equal(readFileSync(resolve(f.root, 'app/dist/index.html'), 'utf8'), 'stale');
});

test('plan peels annotated tags and rejects checkout drift', (t) => {
  const f = fixture(t);
  f.run('git', 'tag', '-d', 'demo-v1.2.3');
  assert.equal(
    f.run(
      'git',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'tag',
      '-am',
      'annotated',
      'demo-v1.2.3',
    ).status,
    0,
  );
  assert.equal(JSON.parse(f.cli('--plan', 'demo-v1.2.3').stdout).sha, f.sha);
  f.put('unrelated.txt', 'new commit');
  f.run('git', 'add', '.');
  f.run(
    'git',
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'drift',
  );
  assert.notEqual(f.cli('--plan', 'demo-v1.2.3').status, 0);
});

function githubFixture(f, scenario = {}) {
  const stateFile = resolve(f.root, 'github-state.json');
  const state = { calls: [], sha: f.sha, scenario, release: null };
  f.put('github-state.json', JSON.stringify(state));
  f.put(
    'bin/gh',
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const file = ${JSON.stringify(stateFile)};
const state = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2);
state.calls.push(args);
function save() { fs.writeFileSync(file, JSON.stringify(state)); }
function emit(value) { save(); console.log(JSON.stringify(value)); }
function fail() { save(); console.error('simulated API/network error'); process.exit(1); }
const endpoint = args.at(-1);
if (args[0] === 'api') {
  if (endpoint.includes('/git/ref/tags/')) {
    if (state.scenario.refError) fail();
    emit({ object: { type: state.scenario.annotated ? 'tag' : 'commit', sha: state.scenario.annotated ? 'c'.repeat(40) : (state.scenario.movedTag ? 'b'.repeat(40) : state.sha) } });
  } else if (endpoint.includes('/git/tags/')) {
    emit({ object: { type: 'commit', sha: state.sha } });
  } else if (endpoint.includes('/releases?')) {
    if (state.scenario.listError) fail();
    let releases = state.scenario.existing ? [{ id: 9, tag_name: 'demo-v1.2.3', draft: true }] : (state.release ? [state.release] : []);
    if (state.release) {
      state.postCreateLists = (state.postCreateLists ?? 0) + 1;
      const outcome = state.scenario.postCreateLists?.[state.postCreateLists - 1];
      if (outcome === 'error') fail();
      if (outcome === 'absent') releases = [];
      if (outcome === 'duplicate') releases = [state.release, { ...state.release, id: 43 }];
      if (outcome === 'invalid') releases = [{}];
    }
    emit([[], releases]);
  } else if (endpoint.includes('/releases/tags/')) {
    // GitHub's tag endpoint is for published releases, not draft discovery.
    fail();
  } else if (endpoint.includes('/releases/')) {
    if (state.scenario.readError) fail();
    const result = structuredClone(state.release);
    if (state.scenario.wrongRelease) result.tag_name = 'other-v1.2.3';
    if (state.scenario.remoteExtra) result.assets.push({ name: 'extra.txt' });
    emit(result);
  } else fail();
} else if (args[0] === 'release' && args[1] === 'create') {
  if (!args.includes('--verify-tag') || !args.includes('--draft')) fail();
  const names = fs.readdirSync('build/release/demo-v1.2.3').filter(n => n !== 'notes.md');
  state.release = { id: 42, tag_name: 'demo-v1.2.3', draft: true, prerelease: false, assets: names.map(name => ({ name })) };
  emit(state.release);
} else if (args[0] === 'release' && args[1] === 'download') {
  const destination = args[args.indexOf('--dir') + 1];
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync('build/release/demo-v1.2.3').filter(n => n !== 'notes.md')) fs.copyFileSync(path.join('build/release/demo-v1.2.3', name), path.join(destination, name));
  if (state.scenario.downloadExtra) fs.writeFileSync(path.join(destination, 'extra.txt'), 'extra');
  if (state.scenario.downloadCorrupt) fs.appendFileSync(path.join(destination, 'demo-1.2.3.zip'), 'corrupt');
  emit({ downloaded: true });
} else if (args[0] === 'release' && args[1] === 'edit') {
  if (!args.includes('--draft=false')) fail();
  state.release.draft = false;
  emit(state.release);
} else fail();
`,
  );
  chmodSync(resolve(f.root, 'bin/gh'), 0o755);
  return () => JSON.parse(readFileSync(stateFile, 'utf8'));
}

function stage(f) {
  assert.equal(f.cli('--build', 'demo-v1.2.3').status, 0);
  const result = f.run('python', 'tooling/package-release.py', 'demo-v1.2.3');
  assert.equal(result.status, 0, result.stderr);
}

test('draft validates transferred package, checks remote tag, creates once and verifies exact downloaded bytes', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f, { annotated: true });
  const result = f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state().release.draft, true);
  assert.deepEqual(
    state()
      .calls.filter((a) => a[0] === 'release')
      .map((a) => a[1]),
    ['create', 'download'],
  );
  assert.ok(state().calls.some((a) => a.includes('--paginate') && a.includes('--slurp')));
  const receipt = JSON.parse(
    readFileSync(resolve(f.root, 'build/release-receipts/demo-v1.2.3.json'), 'utf8'),
  );
  assert.equal(receipt.id, 42);
  assert.equal(receipt.sha, f.sha);
});

test('draft retries a post-create listing that misses the draft and still fails closed', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f, { annotated: true, postCreateLists: ['absent', 'absent'] });
  const result = f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state().calls.filter((a) => a[0] === 'api' && a.includes('--paginate')).length, 4);
  const receipt = JSON.parse(
    readFileSync(resolve(f.root, 'build/release-receipts/demo-v1.2.3.json'), 'utf8'),
  );
  assert.equal(receipt.id, 42);
});

test('draft fails closed when the post-create listing never catches up', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f, {
    annotated: true,
    postCreateLists: ['absent', 'absent', 'absent'],
  });
  const result = f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha);
  assert.notEqual(result.status, 0);
  assert.equal(state().calls.filter((a) => a[0] === 'api' && a.includes('--paginate')).length, 4);
  assert.equal(
    state().calls.some((a) => a[1] === 'edit'),
    false,
  );
  assert.throws(() => readFileSync(resolve(f.root, 'build/release-receipts/demo-v1.2.3.json')));
});

test('draft retries a transient listing error and still verifies the run', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f, { annotated: true, postCreateLists: ['error', 'absent'] });
  const result = f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state().calls.filter((a) => a[0] === 'api' && a.includes('--paginate')).length, 4);
  const receipt = JSON.parse(
    readFileSync(resolve(f.root, 'build/release-receipts/demo-v1.2.3.json'), 'utf8'),
  );
  assert.equal(receipt.id, 42);
});

test('draft rejects a duplicated post-create listing without retrying', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f, { annotated: true, postCreateLists: ['duplicate'] });
  const result = f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha);
  assert.notEqual(result.status, 0);
  assert.equal(state().calls.filter((a) => a[0] === 'api' && a.includes('--paginate')).length, 2);
  assert.equal(
    state().calls.some((a) => a[1] === 'edit'),
    false,
  );
  assert.throws(() => readFileSync(resolve(f.root, 'build/release-receipts/demo-v1.2.3.json')));
});

test('plan refuses missing or unsafe prerequisite declarations', (t) => {
  const f = fixture(t);
  delete f.product.dotnet;
  f.put(
    'tooling/release-products.json',
    JSON.stringify({ schemaVersion: 1, repository: 'owner/repo', products: [f.product] }),
  );
  assert.notEqual(f.cli('--plan', 'demo-v1.2.3').status, 0);
  f.product.dotnet = false;
  f.product.pythonRequirements = 'fonts.txt\ninjected=true';
  f.put(
    'tooling/release-products.json',
    JSON.stringify({ schemaVersion: 1, repository: 'owner/repo', products: [f.product] }),
  );
  assert.notEqual(f.cli('--plan', 'demo-v1.2.3').status, 0);
});

for (const scenario of ['existing', 'listError', 'refError', 'movedTag']) {
  test(`draft refuses ${scenario} without remote writes`, (t) => {
    const f = fixture(t);
    stage(f);
    const state = githubFixture(f, { [scenario]: true });
    const result = f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha);
    assert.notEqual(result.status, 0);
    assert.equal(state().calls.filter((a) => a[0] === 'release').length, 0);
  });
}

for (const scenario of [
  'readError',
  'wrongRelease',
  'remoteExtra',
  'downloadExtra',
  'downloadCorrupt',
]) {
  test(`draft rejects ${scenario} and never records verification or promotes`, (t) => {
    const f = fixture(t);
    stage(f);
    const state = githubFixture(f, { [scenario]: true });
    assert.notEqual(f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha).status, 0);
    assert.equal(state().release.draft, true);
    assert.equal(
      state().calls.some((a) => a[1] === 'edit'),
      false,
    );
    assert.throws(() => readFileSync(resolve(f.root, 'build/release-receipts/demo-v1.2.3.json')));
  });
}

test('corrupt transferred archive is rejected before the first GitHub request', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f);
  f.put('build/release/demo-v1.2.3/demo-1.2.3.zip', 'corrupt archive');
  assert.notEqual(f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha).status, 0);
  assert.deepEqual(state().calls, []);
});

test('promotion is separate, requires this runs verified receipt, revalidates downloads and reads back published state', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f);
  assert.notEqual(f.cli('--promote', 'demo-v1.2.3', '--sha', f.sha).status, 0);
  assert.deepEqual(state().calls, []);
  assert.equal(f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha).status, 0);
  const promoted = f.cli('--promote', 'demo-v1.2.3', '--sha', f.sha);
  assert.equal(promoted.status, 0, promoted.stderr);
  assert.equal(state().release.draft, false);
  assert.deepEqual(state().calls.at(-1).slice(0, 1), ['api']);
});

test('promotion refuses modified downloaded bytes without publishing', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f);
  assert.equal(f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha).status, 0);
  f.put('build/downloaded/demo-v1.2.3/demo-1.2.3.zip', 'modified after verification');
  assert.notEqual(f.cli('--promote', 'demo-v1.2.3', '--sha', f.sha).status, 0);
  assert.equal(state().release.draft, true);
  assert.equal(
    state().calls.some((a) => a[1] === 'edit'),
    false,
  );
});

test('promotion refuses a different release ID even with the same tag', (t) => {
  const f = fixture(t);
  stage(f);
  const state = githubFixture(f);
  assert.equal(f.cli('--draft', 'demo-v1.2.3', '--sha', f.sha).status, 0);
  const replaced = state();
  replaced.release.id = 99;
  f.put('github-state.json', JSON.stringify(replaced));
  assert.notEqual(f.cli('--promote', 'demo-v1.2.3', '--sha', f.sha).status, 0);
  assert.equal(
    state().calls.some((a) => a[1] === 'edit'),
    false,
  );
});

test('plan writes scalar GitHub outputs used by later jobs', (t) => {
  const f = fixture(t);
  const output = resolve(f.root, 'github-outputs.txt');
  const result = spawnSync('node', ['tooling/release-product.mjs', '--plan', 'demo-v1.2.3'], {
    cwd: f.root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: output },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    Object.fromEntries(
      readFileSync(output, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => line.split('=')),
    ),
    {
      tag: 'demo-v1.2.3',
      sha: f.sha,
      product: 'demo',
      dotnet: 'false',
      browser: 'false',
      pythonRequirements: '',
    },
  );
});
