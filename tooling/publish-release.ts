import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIGIT_RE_2 = /^v[1-9]\d*$/;
const DIGIT_RE_2_2 = /^[1-9]\d*$/;
const GIT_SHA40_RE = /^[a-f0-9]{40}$/;
const NEWLINE_SPLIT_RE = /\r?\n/;
const WORD_WORD_RE = /^[\w.-]+\/[\w.-]+$/;

const marker = '<!-- maseaaao:auto-release -->';
interface Result {
  status: number | null;
  stderr: string;
  stdout: string;
}
type Run = (args: string[]) => Result;
interface Asset {
  digest: string | null;
  id: number;
  name: string;
  size: number;
  state: string;
}
interface Release {
  body: string | null;
  draft: boolean;
  id: number;
  name: string;
  prerelease: boolean;
  tag_name: string;
  target_commitish: string;
}

export function shouldSkipRelease(message: string): boolean {
  return message.split(NEWLINE_SPLIT_RE, 1)[0].includes('[skip release]');
}

function verifyDraft(
  current: Release,
  tag: string,
  sha: string,
  assets: Asset[],
  files: { name: string; size: number; digest: string }[],
): void {
  if (
    current.tag_name !== tag ||
    current.name !== tag ||
    current.target_commitish !== sha ||
    current.prerelease
  ) {
    throw new Error('Draft target readback does not match the checked SHA');
  }
  if (
    assets.length !== files.length ||
    files.some(
      (file) =>
        !assets.some(
          (asset) =>
            asset.name === file.name &&
            asset.size === file.size &&
            asset.state === 'uploaded' &&
            asset.digest === file.digest,
        ),
    )
  ) {
    throw new Error('Draft asset verification failed');
  }
}

/** Update only our unpublished candidate. Publishing and creating Git refs are manual. */
export function publishRelease(options: {
  number: string;
  sha: string;
  repo: string;
  root?: string;
  message?: string;
  run?: Run;
}): void {
  if (shouldSkipRelease(options.message ?? '')) {
    return;
  }
  const { number, sha, repo } = options;
  if (
    !(DIGIT_RE_2_2.test(number) && Number.isSafeInteger(Number(number)) && GIT_SHA40_RE.test(sha))
  ) {
    throw new Error('Expected a positive run number and exact commit SHA');
  }
  if (!WORD_WORD_RE.test(repo)) {
    throw new Error('Invalid repository');
  }
  const run: Run = options.run ?? ((args) => spawnSync('gh', args, { encoding: 'utf8' }));
  const command = (args: string[]) => {
    const result = run(args);
    if (result.status !== 0) {
      throw new Error(result.stderr || 'gh command failed');
    }
    return result.stdout;
  };
  const api = <T>(endpoint: string, ...args: string[]): T => {
    const output = command(['api', `repos/${repo}/${endpoint}`, ...args]);
    return (output.trim() ? JSON.parse(output) : undefined) as T;
  };
  const list = <T>(endpoint: string): T[] =>
    api<T[][]>(endpoint + '?per_page=100', '--paginate', '--slurp').flat();
  const tag = `v${number}`;
  const releases = list<Release>('releases');
  const managed = releases.filter((releaseLocal) => releaseLocal.body?.includes(marker));
  if (
    managed.some(
      (releaseLocal) =>
        DIGIT_RE_2.test(releaseLocal.tag_name) &&
        BigInt(releaseLocal.tag_name.slice(1)) > BigInt(number),
    )
  ) {
    return;
  }
  const collision = releases.find((releaseLocal) => releaseLocal.tag_name === tag);
  if (collision && (!collision.body?.includes(marker) || collision.target_commitish !== sha)) {
    throw new Error('Release tag already belongs to another candidate or SHA');
  }
  if (collision && !collision.draft) {
    return; // Published releases are immutable to us.
  }
  const drafts = managed.filter((releaseLocal) => releaseLocal.draft);
  if (drafts.length > 1) {
    throw new Error('Multiple managed drafts; resolve manually');
  }
  const refs = api<{ ref: string }[]>(`git/matching-refs/tags/${tag}`);
  if (refs.some((ref) => ref.ref === `refs/tags/${tag}`)) {
    throw new Error('Candidate tag already exists; use a new release number');
  }
  let [release] = drafts;
  const root = options.root ?? process.cwd();
  const catalog = JSON.parse(readFileSync(join(root, 'tooling/release-products.json'), 'utf8')) as {
    products: { id: string }[];
  };
  const files = [
    `maseaaao-${number}.zip`,
    ...catalog.products.map((product) => `maseaaao-${product.id}-${number}.zip`),
    'SHA256SUMS',
  ].map((name) => {
    const path = join(root, 'dist/release', tag, name);
    const data = readFileSync(path);
    return {
      digest: 'sha256:' + createHash('sha256').update(data).digest('hex'),
      name,
      path,
      size: data.length,
    };
  });
  const fields = ['--raw-field', `tag_name=${tag}`, '--raw-field', `target_commitish=${sha}`];
  const notes = api<{ body: string }>('releases/generate-notes', '--method', 'POST', ...fields);
  const payload = [
    ...fields,
    '--raw-field',
    `name=${tag}`,
    '--raw-field',
    `body=${marker}\n\n${notes.body}`,
    '--field',
    'prerelease=false',
  ];
  const requireDraft = () => {
    const current = api<Release>(`releases/${release.id}`);
    if (!(current.draft && current.body?.includes(marker))) {
      throw new Error('Candidate is no longer our draft');
    }
    return current;
  };
  if (release) {
    requireDraft();
    release = api<Release>(`releases/${release.id}`, '--method', 'PATCH', ...payload);
  } else {
    release = api<Release>('releases', '--method', 'POST', ...payload, '--field', 'draft=true');
  }
  requireDraft();
  command([
    'release',
    'upload',
    tag,
    ...files.map((file) => file.path),
    '--repo',
    repo,
    '--clobber',
  ]);
  requireDraft();
  for (const asset of list<Asset>(`releases/${release.id}/assets`)) {
    if (!files.some((file) => file.name === asset.name)) {
      requireDraft();
      api(`releases/assets/${asset.id}`, '--method', 'DELETE');
    }
  }
  const assets = list<Asset>(`releases/${release.id}/assets`);
  const current = requireDraft();
  verifyDraft(current, tag, sha, assets, files);
}

if (import.meta.main) {
  const sha = process.env.GITHUB_SHA ?? '';
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0 || head.stdout.trim() !== sha) {
    throw new Error('Checkout SHA mismatch');
  }
  const title = spawnSync('git', ['log', '-1', '--format=%s', sha], { encoding: 'utf8' });
  if (title.status !== 0) {
    throw new Error('Cannot read checked commit title');
  }
  publishRelease({
    message: title.stdout,
    number: process.env.GITHUB_RUN_NUMBER ?? '',
    repo: process.env.GITHUB_REPOSITORY ?? '',
    sha,
  });
}
