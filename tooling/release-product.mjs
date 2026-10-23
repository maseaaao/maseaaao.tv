import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'tooling/release-products.json'), 'utf8'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.status}`);
  return result.stdout?.trim() ?? '';
}

function validate(tag) {
  // Python owns strict version, package/Companion version and changelog validation.
  run('python', ['tooling/package-release.py', '--validate', tag]);
  const product = manifest.products.find((item) => tag.startsWith(item.tagPrefix));
  if (typeof product.dotnet !== 'boolean' || typeof product.browser !== 'boolean') {
    throw new Error('Products must explicitly declare dotnet and browser booleans');
  }
  if (
    product.pythonRequirements !== undefined &&
    (typeof product.pythonRequirements !== 'string' ||
      !/^[\w/-]+\.txt$/.test(product.pythonRequirements) ||
      product.pythonRequirements.startsWith('/') ||
      product.pythonRequirements.split('/').includes('..'))
  ) {
    throw new Error('Unsafe Python requirements path');
  }
  return product;
}

function plan(tag) {
  const product = validate(tag);
  run('git', ['show-ref', '--verify', `refs/tags/${tag}`]);
  const sha = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (run('git', ['rev-parse', 'HEAD']) !== sha)
    throw new Error('Checkout must match the tag commit');
  const result = {
    tag,
    sha,
    product: product.id,
    dotnet: product.dotnet,
    browser: product.browser,
    pythonRequirements: product.pythonRequirements ?? '',
  };
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(result))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  console.log(JSON.stringify(result));
}

function build(tag) {
  const product = validate(tag);
  for (const command of [product.build, product.test]) {
    console.log(`==> ${command}`);
    run(command, [], { shell: true, stdio: 'inherit' });
  }
}

function pinnedCommit(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || run('git', ['rev-parse', 'HEAD']) !== sha) {
    throw new Error('Expected the pinned checkout SHA');
  }
}

function repository() {
  const name = process.env.GH_REPO ?? manifest.repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error('Invalid GitHub repository');
  return name;
}

function api(endpoint, options = []) {
  return JSON.parse(run('gh', ['api', ...options, `repos/${repository()}/${endpoint}`]));
}

function remoteTag(tag, sha) {
  let object = api(`git/ref/tags/${encodeURIComponent(tag)}`).object;
  for (let depth = 0; depth < 16 && object?.type === 'tag'; depth++) {
    if (!/^[0-9a-f]{40}$/.test(object.sha)) throw new Error('Invalid remote tag object');
    object = api(`git/tags/${object.sha}`).object;
  }
  if (object?.type !== 'commit' || object.sha !== sha)
    throw new Error('Remote tag no longer matches pinned SHA');
}

function assetNames(tag) {
  return readdirSync(resolve(root, 'build/release', tag))
    .filter((name) => name !== 'notes.md')
    .sort();
}

function releasesForTag(tag) {
  const pages = api('releases?per_page=100', ['--paginate', '--slurp']);
  if (
    !Array.isArray(pages) ||
    pages.some(
      (page) => !Array.isArray(page) || page.some((item) => typeof item.tag_name !== 'string'),
    )
  )
    throw new Error('Invalid release list response');
  return pages.flat().filter((release) => release.tag_name === tag);
}

function sleep(timeout) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeout);
}

// A listing immediately after creating a draft can miss it (read-after-write
// gap under concurrent release runs): retry briefly. A duplicate can only mean
// a real conflict beyond this run's creation, so it fails without retrying.
function draftReadbackId(tag) {
  const delays = [2000, 5000];
  for (let attempt = 0; ; attempt++) {
    let matches = null;
    let error = null;
    try {
      matches = releasesForTag(tag);
    } catch (caught) {
      error = caught;
    }
    if (error === null) {
      if (matches.length === 1) return matches[0].id;
      if (matches.length > 1) throw new Error('Expected exactly one release for this tag');
    }
    if (attempt >= delays.length) {
      if (error !== null) throw error;
      throw new Error('Expected exactly one release for this tag');
    }
    sleep(delays[attempt]);
  }
}

function readRelease(tag, expectedDraft, id) {
  if (id === undefined) {
    id = draftReadbackId(tag);
  }
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid release ID');
  // Read by ID: the by-tag REST endpoint does not discover drafts.
  const release = api(`releases/${id}`);
  if (
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    (id !== undefined && release.id !== id) ||
    release.tag_name !== tag ||
    release.draft !== expectedDraft ||
    release.prerelease !== false
  ) {
    throw new Error('Remote release identity/state differs from this run');
  }
  const names = release.assets?.map((asset) => asset.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(assetNames(tag)))
    throw new Error('Remote asset set differs from verified package');
  return release;
}

function verifyPackage(tag, sha, downloaded = false) {
  pinnedCommit(sha);
  run(
    'python',
    [
      'tooling/package-release.py',
      downloaded ? '--verify-download' : '--verify-package',
      tag,
      '--commit',
      sha,
    ],
    { stdio: 'inherit' },
  );
}

function draft(tag, sha) {
  verifyPackage(tag, sha);
  remoteTag(tag, sha);
  // Listing is deliberate: a failed view/404/network call must never mean "absent".
  if (releasesForTag(tag).length)
    throw new Error('Release already exists; refusing to overwrite artifacts');
  const releaseDir = resolve(root, 'build/release', tag);
  const downloaded = resolve(root, 'build/downloaded', tag);
  if (existsSync(downloaded))
    throw new Error('Download directory already exists; refusing stale verification');
  remoteTag(tag, sha);
  run('gh', [
    'release',
    'create',
    tag,
    ...assetNames(tag).map((name) => resolve(releaseDir, name)),
    '--repo',
    repository(),
    '--verify-tag',
    '--draft',
    '--prerelease=false',
    '--title',
    tag,
    '--notes-file',
    resolve(releaseDir, 'notes.md'),
  ]);
  const release = readRelease(tag, true);
  remoteTag(tag, sha);
  run('gh', ['release', 'download', tag, '--repo', repository(), '--dir', downloaded]);
  verifyPackage(tag, sha, true);
  readRelease(tag, true, release.id);
  remoteTag(tag, sha);
  const receipts = resolve(root, 'build/release-receipts');
  mkdirSync(receipts, { recursive: true });
  writeFileSync(
    resolve(receipts, `${tag}.json`),
    JSON.stringify({ tag, sha, id: release.id }) + '\n',
    { flag: 'wx' },
  );
  console.log(`Verified draft ${tag} (${release.id}); not published`);
}

function promote(tag, sha) {
  verifyPackage(tag, sha, true);
  const receipt = JSON.parse(
    readFileSync(resolve(root, 'build/release-receipts', `${tag}.json`), 'utf8'),
  );
  if (receipt.tag !== tag || receipt.sha !== sha || !Number.isSafeInteger(receipt.id)) {
    throw new Error('No matching verified draft receipt from this run');
  }
  remoteTag(tag, sha);
  readRelease(tag, true, receipt.id);
  run('gh', ['release', 'edit', tag, '--repo', repository(), '--draft=false']);
  readRelease(tag, false, receipt.id);
  console.log(`Published verified release ${tag} (${receipt.id})`);
}

const [mode, tag, shaFlag, sha, ...extra] = process.argv.slice(2);
try {
  if (extra.length || (shaFlag !== undefined && shaFlag !== '--sha'))
    throw new Error('Unexpected arguments');
  if (mode === '--draft' && tag && shaFlag === '--sha') draft(tag, sha);
  else if (mode === '--promote' && tag && shaFlag === '--sha') promote(tag, sha);
  else if (mode === '--plan' && tag && !shaFlag) plan(tag);
  else if (mode === '--build' && tag && !shaFlag) build(tag);
  else if (mode && !mode.startsWith('--') && !tag) build(mode);
  else
    throw new Error(
      'Usage: release-product.mjs --plan|--build <tag>, or --draft|--promote <tag> --sha <commit>',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
