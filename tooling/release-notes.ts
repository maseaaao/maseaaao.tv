/** GitHub Release notes generated from commits, including changes pushed without pull requests. */

export interface ReleaseCommit {
  commit: { message: string };
  sha: string;
}

type Category = 'Новые возможности' | 'Исправления' | 'Улучшения' | 'Технические изменения' | 'Прочие изменения';

const COMMIT_TYPE = /^(feat|fix|perf|refactor|style|design|artwork|widgets|obs|integrations|docs|test|chore|ci|build)(?:\(([^)]+)\))?!?:\s*(.+)$/i;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const RELEASE_TAG = /^v[1-9]\d*$/;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const MERGE_COMMIT = /^Merge pull request #\d+\b/;
const CATEGORIES: Category[] = [
  'Новые возможности',
  'Исправления',
  'Улучшения',
  'Технические изменения',
  'Прочие изменения',
];

function categoryFor(type: string | undefined): Category {
  switch (type?.toLowerCase()) {
    case 'feat':
      return 'Новые возможности';
    case 'fix':
      return 'Исправления';
    case 'perf':
    case 'refactor':
    case 'style':
    case 'design':
    case 'artwork':
    case 'widgets':
    case 'obs':
    case 'integrations':
      return 'Улучшения';
    case 'docs':
    case 'test':
    case 'chore':
    case 'ci':
    case 'build':
      return 'Технические изменения';
    default:
      return 'Прочие изменения';
  }
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

/** Format only factual commit subjects; do not invent or translate release changes. */
export function formatReleaseNotes(options: {
  repo: string;
  tag: string;
  previousTag: string;
  commits: ReleaseCommit[];
}): string {
  const { repo, tag, previousTag, commits } = options;
  if (!(REPO_NAME.test(repo) && RELEASE_TAG.test(tag) && RELEASE_TAG.test(previousTag))) {
    throw new Error('Invalid release comparison');
  }
  const grouped = new Map<Category, string[]>();
  const seen = new Set<string>();
  for (const item of commits) {
    if (!COMMIT_SHA.test(item.sha)) {
      throw new Error('Invalid compared commit SHA');
    }
    const subject = item.commit.message.split(/\r?\n/, 1)[0]?.trim();
    if (!subject || MERGE_COMMIT.test(subject) || seen.has(subject)) {
      continue;
    }
    seen.add(subject);
    const parsed = subject.match(COMMIT_TYPE);
    const category = categoryFor(parsed?.[1]);
    const scope = parsed?.[2] ? `\`\${escapeMarkdown(parsed[2])}\`\` : '';
    const title = escapeMarkdown(parsed?.[3] ?? subject);
    const label = scope ? `\${scope}: \${title}` : title;
    const line = `- \${label} ([\`\${item.sha.slice(0, 7)}\`](https://github.com/\${repo}/commit/\${item.sha}))`;
    grouped.set(category, [...(grouped.get(category) ?? []), line]);
  }

  const sections = CATEGORIES.flatMap((category) => {
    const changes = grouped.get(category);
    return changes?.length ? [`## \${category}\n\${changes.join('\n')}`] : [];
  });
  if (sections.length === 0) {
    sections.push('Изменений в коммитах относительно предыдущего релиза нет.');
  }
  sections.push(`**Полный список изменений:** https://github.com/\${repo}/compare/\${previousTag}...\${tag}`);
  return sections.join('\n\n');
}
