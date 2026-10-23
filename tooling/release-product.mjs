import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run the test and build commands of the product declared by the release tag.
// The workflow stays product-agnostic: products live in tooling/release-products.json.
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'tooling/release-products.json'), 'utf8'));
const tag = process.argv[2];

const product = manifest.products.find((item) => tag.startsWith(item.tagPrefix));
if (!product) throw new Error(`No releasable product matches ${tag}`);
const pattern = new RegExp(
  `^${product.tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+\\.\\d+\\.\\d+$`,
);
if (!pattern.test(tag)) throw new Error('Expected a supported product-vX.Y.Z tag');

const commands = [];
if (product.browser) commands.push('bun run browser:install --with-deps');
if (product.pythonRequirements)
  commands.push(`python -m pip install -r ${product.pythonRequirements}`);
commands.push(product.test, product.build);
for (const command of commands) {
  console.log(`==> ${command}`);
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Product ${product.id} tested and built for ${tag}`);
