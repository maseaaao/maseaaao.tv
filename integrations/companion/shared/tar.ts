import { execFileSync } from 'node:child_process';

const GNU_TAR_RE = /GNU tar/;

let gnuTar: boolean | null = null;
function isGnuTar() {
  if (gnuTar === null) {
    try {
      gnuTar = GNU_TAR_RE.test(execFileSync('tar', ['--version'], { encoding: 'utf8' }));
    } catch {
      gnuTar = false;
    }
  }
  return gnuTar;
}

// GNU tar reads `host:path` as a remote archive and takes a Windows `C:\...` path for
// host "C"; bsdtar has no remote syntax and rejects the flag, hence the version probe.
export function tarArgs(args: string[]) {
  return isGnuTar() ? ['--force-local', ...args] : args;
}
