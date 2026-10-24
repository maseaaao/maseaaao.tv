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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageModule(directory, helper, request, extra = []) {
  const module = fileURLToPath(directory);
  const manifest = JSON.parse(readFileSync(join(module, 'companion/manifest.json'), 'utf8'));
  const { id, version } = manifest;
  if (!/^[a-z][a-z0-9-]*$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Invalid module ID or version');
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
    ];
    for (const name of files) {
      if (!lstatSync(join(module, name)).isFile()) throw new Error(`Not a regular file: ${name}`);
      const target = join(staging, id, name);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(module, name), target);
    }
    writeFileSync(
      join(staging, id, 'package.json'),
      JSON.stringify({
        name: id,
        version,
        type: 'module',
        ...(request === 'request.json' ? { dependencies: {} } : {}),
      }),
    );
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
        `${id}/package.json`,
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      },
    );
    writeFileSync(
      join(module, request),
      JSON.stringify({
        path: 'instances.modulesManager.installModuleTar',
        input: { tarBuffer: readFileSync(archive).toString('base64') },
      }),
    );
    console.log(`${id}-${version}.tgz`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
