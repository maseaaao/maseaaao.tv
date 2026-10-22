import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
const root = fileURLToPath(new URL('../', import.meta.url));
export function readWorkspaces() {
  const { packages } = parse(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'));
  return packages
    .flatMap((pattern) =>
      pattern.endsWith('/*')
        ? readdirSync(resolve(root, pattern.slice(0, -2)), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => pattern.slice(0, -1) + entry.name)
        : [pattern],
    )
    .map((directory) => ({
      directory,
      ...JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')),
    }));
}
export function selectAffected(files, workspaces, full = false) {
  const selected = new Set();
  for (const file of files) {
    if (/^(?:docs\/|README\.md$|AGENTS\.md$)/.test(file)) continue;
    const owner = workspaces.find((pkg) => file.startsWith(pkg.directory + '/'));
    if (owner) selected.add(owner.name);
    else full = true; // Unknown paths and root tooling/configuration fail closed.
  }
  if (full) for (const pkg of workspaces) selected.add(pkg.name);
  let size;
  do {
    size = selected.size;
    for (const pkg of workspaces) {
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (Object.keys(dependencies).some((name) => selected.has(name))) selected.add(pkg.name);
    }
    // Website copies raster outputs, not artwork's source exports. This is a
    // file-consumer edge, not a cyclic package dependency (artwork uses its QR).
    if (selected.has('@maseaaao/artwork')) selected.add('@maseaaao/website');
  } while (size !== selected.size);
  const affected = workspaces.filter((pkg) => selected.has(pkg.name));
  return {
    full,
    source: true,
    products: affected.some((pkg) => !pkg.directory.startsWith('integrations/')),
    raster: selected.has('@maseaaao/artwork'),
    companion: affected.some((pkg) => pkg.directory.startsWith('integrations/companion/')),
    packages: [...selected].sort(),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let files = [],
    full = process.argv.includes('--full') || !process.env.BASE_SHA;
  if (!full) {
    try {
      files = execFileSync(
        'git',
        ['diff', '--name-only', '--no-renames', '-z', `${process.env.BASE_SHA}...HEAD`],
        { cwd: root, encoding: 'utf8' },
      )
        .split('\0')
        .filter(Boolean);
    } catch (error) {
      console.error(`Cannot establish change base; selecting all checks: ${error.message}`);
      full = true;
    }
  }
  const plan = selectAffected(files, readWorkspaces(), full);
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT)
    for (const [key, value] of Object.entries(plan))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${JSON.stringify(value)}\n`);
}
