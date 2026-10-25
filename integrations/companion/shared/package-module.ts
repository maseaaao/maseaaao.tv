import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIGIT_DOTDIGIT_DOTDIGIT_RE = /^\d+\.\d+\.\d+$/;
const KEBAB_CASE_RE = /^[a-z][a-z0-9-]*$/;

export function prepareModuleMetadata(directory: URL, request: string) {
  const source = fileURLToPath(directory);
  const output = fileURLToPath(new URL(`../../../dist/companion/${basename(source)}/`, directory));
  const { id, version } = JSON.parse(
    readFileSync(join(source, 'companion/manifest.json'), 'utf8'),
  ) as { id: string; version: string };
  if (!(KEBAB_CASE_RE.test(id) && DIGIT_DOTDIGIT_DOTDIGIT_RE.test(version))) {
    throw new Error('Invalid module ID or version');
  }
  mkdirSync(join(output, 'companion'), { recursive: true });
  for (const name of ['manifest.json', 'HELP.md']) {
    copyFileSync(join(source, 'companion', name), join(output, 'companion', name));
  }
  writeFileSync(
    join(output, 'package.json'),
    JSON.stringify({
      name: id,
      type: 'commonjs',
      version,
      ...(request === 'request.json' ? { dependencies: {} } : {}),
    }),
  );
  return output;
}

export function packageModule(
  directory: URL,
  helper: string,
  request: string,
  extra: string[] = [],
) {
  const module = prepareModuleMetadata(directory, request);
  const manifest: { id: string; version: string } = JSON.parse(
    readFileSync(join(module, 'companion/manifest.json'), 'utf8'),
  );
  const { id, version } = manifest;
  if (!(KEBAB_CASE_RE.test(id) && DIGIT_DOTDIGIT_DOTDIGIT_RE.test(version))) {
    throw new Error('Invalid module ID or version');
  }
  const archive = join(module, `${id}-${version}.tgz`);
  const staging = mkdtempSync(join(tmpdir(), 'companion-package-'));
  try {
    mkdirSync(join(staging, id));
    const files = [
      'main.js',
      helper,
      'NAudio.Core.dll',
      'NAudio.Wasapi.dll',
      'companion/manifest.json',
      'companion/HELP.md',
      ...extra,
      'package.json',
    ];
    for (const name of files) {
      if (!lstatSync(join(module, name)).isFile()) {
        throw new Error(`Not a regular file: ${name}`);
      }
      const target = join(staging, id, name);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(module, name), target);
    }
    // Explicit entries preserve the existing archive layout (no extra companion/ directory).
    execFileSync(
      'tar',
      [
        '--no-recursion',
        '-czf',
        archive,
        '-C',
        staging,
        `${id}/`,
        ...files.map((name) => `${id}/${name}`),
      ],
      {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
        stdio: 'inherit',
      },
    );
    writeFileSync(
      join(module, request),
      JSON.stringify({
        input: { tarBuffer: readFileSync(archive).toString('base64') },
        path: 'instances.modulesManager.installModuleTar',
      }),
    );
    console.log(`${id}-${version}.tgz`);
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}
