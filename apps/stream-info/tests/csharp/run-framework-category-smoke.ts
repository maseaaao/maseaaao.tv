// Compile/run backend smoke with installed .NET Framework, in temporary scratch only.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const framework = join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319');
const compiler = join(framework, 'csc.exe');
if (!existsSync(compiler)) {
  throw new Error('Installed .NET Framework compiler is unavailable; smoke was not run.');
}
const scratch = mkdtempSync(join(tmpdir(), 'category-search-verify-'));
try {
  const files = [
    'category-search-policy.cs',
    'category-search-service.cs',
    'category-search-transport.cs',
  ];
  for (const name of files) {
    copyFileSync(join(root, 'streamerbot', name), join(scratch, name));
  }
  copyFileSync(
    join(root, 'tests/csharp/FrameworkCategorySmoke.cs'),
    join(scratch, 'FrameworkCategorySmoke.cs'),
  );
  const reference = '/r:' + join(framework, 'System.Net.Http.dll');
  const commands: [command: string, args: string[]][] = [
    [compiler, ['/nologo', '/target:library', '/out:backend.dll', reference, ...files]],
    [
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/out:smoke.exe',
        '/r:backend.dll',
        reference,
        'FrameworkCategorySmoke.cs',
      ],
    ],
    [join(scratch, 'smoke.exe'), []],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: scratch, windowsHide: true });
    for (const output of [result.stdout, result.stderr]) {
      if (output?.length) {
        console.log(new TextDecoder('ibm866').decode(output).trim());
      }
    }
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
  if (!process.exitCode) {
    console.log(
      'Framework compilation and smoke execution exit: 0 (scratch only; no live app/data changes).',
    );
  }
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
