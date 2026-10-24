// Windows launcher. Only the CLI entry point starts Companion.
import { execFile, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function startCompanion(argv, dependencies = {}) {
  const {
    env = process.env,
    platform = process.platform,
    runFile = execute,
    spawnProcess = spawn,
    request = fetch,
    sleep = setTimeout,
    log = console.log,
  } = dependencies;
  let root = env.STREAMERBOT_ROOT;
  let openAdmin = false;
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (['--open-admin', '-OpenAdmin'].includes(option)) openAdmin = true;
    else if (['--streamerbot-root', '-StreamerbotRoot'].includes(option)) {
      root = argv[++index];
      if (!root || root.startsWith('-')) throw new Error('Missing StreamerbotRoot directory.');
    } else throw new Error(`Unknown argument: ${option}`);
  }
  if (platform !== 'win32') throw new Error('Run this launcher with Windows Node.js or Bun.');
  if (!env.ProgramFiles) throw new Error('ProgramFiles is not set.');
  root = path.resolve(root?.trim() || path.resolve(import.meta.dirname, '../../../Streamer.bot'));
  const install = path.join(env.ProgramFiles, 'Companion');
  const resources = path.join(install, 'resources');
  const configDirectory = path.join(root, 'custom/companion/data');
  const main = path.join(resources, 'main.js');
  await access(main);
  const config = JSON.parse(
    (await readFile(path.join(configDirectory, 'config.json'), 'utf8')).replace(/^\uFEFF/, ''),
  );
  const machineId = (await readFile(path.join(configDirectory, 'machid'), 'utf8')).trim();
  if (!machineId) throw new Error('Companion machine id is empty.');
  const runtimeRoot = path.join(resources, 'node-runtimes');
  const runtimes = (await readdir(runtimeRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort(
      (a, b) => Number(b.name.match(/(\d+)$/)?.[1] || 0) - Number(a.name.match(/(\d+)$/)?.[1] || 0),
    );
  let executable;
  for (const entry of runtimes) {
    const candidate = path.join(runtimeRoot, entry.name, 'node.exe');
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!executable)
    throw new Error(`Companion's bundled Node.js runtime was not found in ${resources}`);
  const port = Number(config.http_port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid Companion HTTP port.');
  const address = config.bind_ip?.trim() || '0.0.0.0';
  const host = ['0.0.0.0', '::'].includes(address) ? '127.0.0.1' : address;
  const uri = `http://${host.includes(':') ? `[${host}]` : host}:${port}/`;
  const ready = async () => {
    try {
      const response = await request(uri, { signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
  };
  // WMI exposes executable paths; tasklist does not. Fail closed if WSH/WMI is unavailable.
  const { stdout } = await runFile(
    path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cscript.exe'),
    ['//Nologo', '//U', fileURLToPath(new URL('./companion-processes.wsf', import.meta.url))],
    { encoding: 'utf16le', windowsHide: true, timeout: 10000 },
  );
  const prefix = path.win32.resolve(install).toLowerCase() + '\\';
  const running = stdout.split(/\r?\n/).find((line) => {
    const [pid, filename] = line.split('\t');
    return Number(pid) !== process.pid && filename?.toLowerCase().startsWith(prefix);
  });
  const showAdmin = async () => {
    if (openAdmin)
      await runFile(
        path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'),
        ['url.dll,FileProtocolHandler', uri],
        { windowsHide: true },
      );
  };
  if (running) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await ready()) {
        await showAdmin();
        log(`Companion is already running (PID ${running.split('\t')[0]}, ${address}:${port}).`);
        return;
      }
      await sleep(250);
    }
    throw new Error(
      `Companion is already running, but ${uri} did not become ready within 10 seconds. A second instance was not started.`,
    );
  }
  if (await ready())
    throw new Error(
      `Address ${address}:${port} is already served by another process. Companion was not started.`,
    );
  const args = [
    '--use-system-ca',
    main,
    `--machine-id=${machineId}`,
    `--config-dir=${configDirectory}`,
    `--admin-port=${port}`,
    `--admin-address=${address}`,
  ];
  if (config.log_level?.trim()) args.push(`--log-level=${config.log_level}`);
  if (config.enable_shell_command_support) args.push('--enable-shell-command-support');
  if (config.enable_restricted_modules) args.push('--enable-restricted-modules');
  if (config.trusted_proxies?.trim()) args.push(`--trusted-proxies=${config.trusted_proxies}`);
  if (config.enable_developer && config.dev_modules_path?.trim())
    args.push(`--extra-module-path=${config.dev_modules_path}`);
  if (config.enable_syslog) {
    args.push(
      '--syslog-enable',
      `--syslog-host=${config.syslog_host}`,
      `--syslog-port=${config.syslog_port}`,
    );
    if (config.syslog_use_tcp) args.push('--syslog-tcp');
    if (config.syslog_local_hostname?.trim())
      args.push(`--syslog-localhost=${config.syslog_local_hostname}`);
  }
  const child = spawnProcess(executable, args, {
    cwd: resources,
    windowsHide: true,
    stdio: 'ignore',
  });
  let failure;
  child.on('error', (error) => {
    failure = error;
  });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(250);
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Companion exited during startup with code ${child.exitCode}.`);
    if (await ready()) {
      await showAdmin();
      log(`Companion started with portable configuration (PID ${child.pid}, ${address}:${port}).`);
      return;
    }
  }
  throw new Error(
    `Companion process ${child.pid} started, but ${uri} did not become reachable within 15 seconds.`,
  );
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  startCompanion(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
