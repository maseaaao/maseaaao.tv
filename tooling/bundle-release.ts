/** Full and per-product manual-install ZIPs. No updater protocol. */
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
import type { Zippable } from 'fflate';
import { unzipSync, zipSync } from 'fflate';

const CC_RE = /[\\:]|\p{Cc}/u;
const TRAILING_DOT_OR_SPACE_RE = /[. ]$/;

interface ReleaseProduct {
  build?: string;
  extensions?: string[];
  files: { source: string; target: string }[];
  id: string;
  path: string;
  versionFile?: string;
}
interface ReleaseCatalog {
  products: ReleaseProduct[];
  schemaVersion: number;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    build: { type: 'boolean' },
    root: { type: 'string' },
    'validate-catalog': { type: 'boolean' },
  },
});
const root = resolve(values.root || resolve(import.meta.dirname, '..'));
const json = <T>(name: string): T => JSON.parse(readFileSync(join(root, name), 'utf8'));
const safe = (name: string) => {
  if (
    !name ||
    CC_RE.test(name) ||
    name
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || TRAILING_DOT_OR_SPACE_RE.test(part))
  ) {
    throw new Error(`Unsafe release path: ${name}`);
  }
  return name;
};
const sourcePath = (name: string) => {
  let path = root;
  for (const part of safe(name).split('/')) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Release symlink: ${name}`);
    }
  }
  return path;
};
const catalog = json<ReleaseCatalog>('tooling/release-products.json');
if (catalog.schemaVersion !== 2 || !(Array.isArray(catalog.products) && catalog.products.length)) {
  throw new Error('Invalid release catalog');
}
const ids = new Set();
for (const product of catalog.products) {
  if (
    !/^[a-z][a-z-]*$/.test(product.id) ||
    ids.has(product.id) ||
    !(Array.isArray(product.files) && product.files.length)
  ) {
    throw new Error('Invalid or duplicate product');
  }
  ids.add(product.id);
  safe(product.path);
  for (const mapping of product.files) {
    safe(mapping.source);
    if (mapping.target !== '.') {
      safe(mapping.target);
    }
  }
}
if (values['validate-catalog']) {
  console.log('Release catalog is valid');
} else {
  const [tag] = positionals;
  if (
    positionals.length !== 1 ||
    !/^v[1-9]\d*$/.test(tag) ||
    !Number.isSafeInteger(Number(tag.slice(1)))
  ) {
    throw new Error('Expected bundle tag vN (positive safe integer, no leading zeros)');
  }
  const version = tag.slice(1);
  const productVersion = `2.0.${version}`;
  if (values.build) {
    for (const script of [
      'full',
      'build:companion',
      'package:companion',
      'check',
      'test',
      'verify:companion',
    ]) {
      const command = `bun run ${script}`;
      console.log(`==> ${command}`);
      execSync(command, { cwd: root, stdio: 'inherit', timeout: 600_000 });
    }
  } else {
    const files: Record<string, Buffer> = Object.create(null);
    const seen = new Set();
    const add = (source: string, target: string) => {
      safe(target);
      if (seen.has(target.toLowerCase())) {
        throw new Error(`Duplicate release target: ${target}`);
      }
      seen.add(target.toLowerCase());
      files[target] = readFileSync(sourcePath(source));
    };
    for (const product of catalog.products) {
      for (const mapping of product.files) {
        const source = mapping.source.replaceAll('{version}', productVersion);
        const target =
          mapping.target === '.' ? '' : mapping.target.replaceAll('{version}', productVersion);
        const before = seen.size;
        const walk = (name: string, destination: string): void => {
          const path = sourcePath(name);
          if (lstatSync(path).isDirectory()) {
            for (const child of readdirSync(path).sort()) {
              if (
                ['.cache', 'release', 'node_modules', 'review'].includes(child) ||
                child.endsWith('-report.json')
              ) {
                continue;
              }
              walk(`${name}/${child}`, destination ? `${destination}/${child}` : child);
            }
          } else {
            if (product.extensions && !product.extensions.includes(extname(name).toLowerCase())) {
              return;
            }
            add(name, `${product.id}/${destination || name.split('/').at(-1)}`);
          }
        };
        walk(source, target);
        if (before === seen.size) {
          throw new Error(`Empty release mapping: ${source}`);
        }
      }
      for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        if (existsSync(join(root, product.path, name)) && !files[`${product.id}/${name}`]) {
          add(`${product.path}/${name}`, `${product.id}/${name}`);
        }
      }
      const walkLicenses = (name: string, target: string): void => {
        if (lstatSync(sourcePath(name)).isDirectory()) {
          for (const child of readdirSync(join(root, name)).sort()) {
            walkLicenses(`${name}/${child}`, `${target}/${child}`);
          }
        } else if (!files[target]) {
          add(name, target);
        }
      };
      if (existsSync(join(root, product.path, 'licenses'))) {
        walkLicenses(`${product.path}/licenses`, `${product.id}/licenses`);
      }
      const fontLicense = `${product.id}/licenses/Unbounded-OFL.txt`;
      if (!files[fontLicense]) {
        add('packages/design/licenses/Unbounded-OFL.txt', fontLicense);
      }
    }
    add('LICENSE', 'LICENSE');
    add('docs/windows-releases.md', 'INSTALL.md');
    const entries: Zippable = Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => {
          if (a < b) {
            return -1;
          }
          if (a > b) {
            return 1;
          }
          return 0;
        })
        .map(
          ([name, bytes]): [string, [Uint8Array, { mtime: Date; os: number; attrs: number }]] => [
            name,
            // biome-ignore lint/suspicious/noBitwiseOperators: Packed RGB channels and binary protocol fields require bitwise operations.
            [bytes, { attrs: 0o10_0644 << 16, mtime: new Date(2020, 0, 1), os: 3 }],
          ],
        ),
    );
    const output = join(root, 'dist/release', tag);
    for (const name of ['dist', 'dist/release', `dist/release/${tag}`]) {
      if (existsSync(join(root, name))) {
        sourcePath(name);
      }
    }
    rmSync(output, { force: true, recursive: true });
    mkdirSync(output, { recursive: true });
    const checksums: string[] = [];
    const archive = (filename: string, contents: Zippable) => {
      const zip = zipSync(contents, { level: 6 });
      const unpacked = unzipSync(zip);
      if (
        Object.keys(unpacked).length !== Object.keys(contents).length ||
        Object.keys(contents).some((name) => !Buffer.from(unpacked[name] || []).equals(files[name]))
      ) {
        throw new Error(`ZIP roundtrip mismatch: ${filename}`);
      }
      writeFileSync(join(output, filename), zip);
      checksums.push(`${createHash('sha256').update(zip).digest('hex')}  ${filename}\n`);
    };
    archive(`maseaaao-${version}.zip`, entries);
    for (const product of catalog.products) {
      archive(
        `maseaaao-${product.id}-${version}.zip`,
        Object.fromEntries(
          Object.entries(entries).filter(
            ([name]) =>
              name.startsWith(`${product.id}/`) || name === 'LICENSE' || name === 'INSTALL.md',
          ),
        ),
      );
    }
    writeFileSync(join(output, 'SHA256SUMS'), checksums.join(''));
    console.log(
      `Packaged ${catalog.products.length} products, ${seen.size} files into ${checksums.length} ZIPs: ${output}`,
    );
  }
}
