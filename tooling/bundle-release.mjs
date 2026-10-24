/** One manual-install ZIP. fflate owns the archive format; no updater protocol. */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { unzipSync, zipSync } from 'fflate';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    build: { type: 'boolean' },
    'validate-catalog': { type: 'boolean' },
  },
});
const root = resolve(values.root || resolve(import.meta.dirname, '..'));
const json = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const safe = (name) => {
  if (
    !name ||
    /[\\:]|\p{Cc}/u.test(name) ||
    name.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  )
    throw new Error(`Unsafe release path: ${name}`);
  return name;
};
const sourcePath = (name) => {
  let path = root;
  for (const part of safe(name).split('/')) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Release symlink: ${name}`);
  }
  return path;
};
const catalog = json('tooling/release-products.json');
if (catalog.schemaVersion !== 2 || !catalog.products?.length)
  throw new Error('Invalid release catalog');
const ids = new Set();
for (const product of catalog.products) {
  if (!/^[a-z][a-z-]*$/.test(product.id) || ids.has(product.id) || !product.files?.length)
    throw new Error('Invalid or duplicate product');
  ids.add(product.id);
  safe(product.path);
  for (const mapping of product.files) {
    safe(mapping.source);
    if (mapping.target !== '.') safe(mapping.target);
  }
}
if (values['validate-catalog']) {
  console.log('Release catalog is valid');
} else {
  const tag = positionals[0];
  if (positionals.length !== 1 || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    throw new Error('Expected bundle tag v1.2.3');
  const version = tag.slice(1);
  const section = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
    .split(/^## /m)
    .find((part) => part.split(/\r?\n/)[0].trim() === version);
  const notes = section?.split(/\r?\n/).slice(1).join('\n').trim();
  if (!notes) throw new Error(`Missing CHANGELOG.md section for ${version}`);
  if (values.build) {
    for (const product of catalog.products) {
      for (const command of [product.build, product.test]) {
        if (!command) throw new Error(`Missing build/test command for ${product.id}`);
        console.log(`==> ${command}`);
        execSync(command, { cwd: root, stdio: 'inherit', timeout: 600000 });
      }
    }
  } else {
    const files = Object.create(null);
    const seen = new Set();
    const add = (source, target) => {
      safe(target);
      if (seen.has(target.toLowerCase())) throw new Error(`Duplicate release target: ${target}`);
      seen.add(target.toLowerCase());
      files[target] = readFileSync(sourcePath(source));
    };
    for (const product of catalog.products) {
      const productVersion = json(product.versionFile || `${product.path}/package.json`).version;
      if (!/^\d+\.\d+\.\d+$/.test(productVersion))
        throw new Error(`Invalid version: ${product.id}`);
      for (const mapping of product.files) {
        const source = mapping.source.replaceAll('{version}', productVersion);
        const target =
          mapping.target === '.' ? '' : mapping.target.replaceAll('{version}', productVersion);
        const before = seen.size;
        const walk = (name, destination) => {
          const path = sourcePath(name);
          if (lstatSync(path).isDirectory()) {
            for (const child of readdirSync(path).sort()) {
              if (child === 'review' || child.endsWith('-report.json')) continue;
              walk(`${name}/${child}`, destination ? `${destination}/${child}` : child);
            }
          } else {
            if (product.extensions && !product.extensions.includes(extname(name).toLowerCase()))
              return;
            add(name, `${product.id}/${destination || name.split('/').at(-1)}`);
          }
        };
        walk(source, target);
        if (before === seen.size) throw new Error(`Empty release mapping: ${source}`);
      }
      for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        if (existsSync(join(root, product.path, name)) && !files[`${product.id}/${name}`])
          add(`${product.path}/${name}`, `${product.id}/${name}`);
      }
      const walkLicenses = (name, target) => {
        if (lstatSync(sourcePath(name)).isDirectory()) {
          for (const child of readdirSync(join(root, name)).sort())
            walkLicenses(`${name}/${child}`, `${target}/${child}`);
        } else if (!files[target]) add(name, target);
      };
      if (existsSync(join(root, product.path, 'licenses')))
        walkLicenses(`${product.path}/licenses`, `${product.id}/licenses`);
      const fontLicense = `${product.id}/licenses/Unbounded-OFL.txt`;
      if (!files[fontLicense]) add('packages/design/licenses/Unbounded-OFL.txt', fontLicense);
    }
    add('docs/windows-releases.md', 'INSTALL.md');
    const entries = Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, bytes]) => [
          name,
          [bytes, { mtime: new Date(2020, 0, 1), os: 3, attrs: 0o100644 << 16 }],
        ]),
    );
    const zip = zipSync(entries, { level: 6 });
    const unpacked = unzipSync(zip);
    if (
      Object.keys(unpacked).length !== seen.size ||
      Object.entries(files).some(
        ([name, bytes]) => !Buffer.from(unpacked[name] || []).equals(bytes),
      )
    )
      throw new Error('ZIP roundtrip mismatch');
    const output = join(root, 'build/release', tag);
    for (const name of ['build', 'build/release', `build/release/${tag}`])
      if (existsSync(join(root, name))) sourcePath(name);
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });
    const filename = `maseaaao-${version}.zip`;
    writeFileSync(join(output, filename), zip);
    writeFileSync(
      join(output, 'SHA256SUMS'),
      `${createHash('sha256').update(zip).digest('hex')}  ${filename}\n`,
    );
    writeFileSync(join(output, 'notes.md'), `${notes}\n`);
    console.log(
      `Packaged ${catalog.products.length} products, ${seen.size} files: ${output}/${filename}`,
    );
  }
}
