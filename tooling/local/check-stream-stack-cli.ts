// Human-readable diagnostics wrapper. The underlying checker keeps its JSON interface.

import type { ExecFileOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { DiagnosticsReport } from './diagnostic-types.ts';

interface CommandOutput {
  stderr: string;
  stdout: string;
}
interface DiagnosticOptions {
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  runFile?: (file: string, args: string[], options: ExecFileOptions) => Promise<CommandOutput>;
}

const execute = promisify(execFile);

function diagnosticsRoot(argv: string[], env: NodeJS.ProcessEnv): string {
  let root = env.STREAMERBOT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    if (!['--streamerbot-root', '-StreamerbotRoot'].includes(argv[index])) {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
    index += 1;
    root = argv[index];
    if (!root || root.startsWith('-')) {
      throw new Error('Missing StreamerbotRoot directory.');
    }
  }
  root = path.resolve(root?.trim() || path.resolve(import.meta.dirname, '../../../Streamer.bot'));

  return root;
}

export async function runDiagnostics(
  argv: string[],
  { env = process.env, runFile = execute, log = console.log }: DiagnosticOptions = {},
) {
  const root = diagnosticsRoot(argv, env);
  const reportFile = path.join(root, 'logs/stream-stack-latest.json');
  log('Проверка Streamer.bot, Companion и OBS. Все три приложения должны быть запущены.');
  let output: CommandOutput;
  let code = 0;
  try {
    output = await runFile(
      process.execPath,
      [fileURLToPath(new URL('./check-stream-stack.ts', import.meta.url)), '--report', reportFile],
      {
        env: { ...env, STREAMERBOT_ROOT: root },
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );
  } catch (error) {
    if (
      typeof error !== 'object' ||
      // biome-ignore lint/suspicious/noUnnecessaryConditions: A rejected promise may carry null; typeof null is object.
      error === null ||
      !('code' in error) ||
      typeof error.code !== 'number' ||
      ![1, 2].includes(error.code) ||
      !('stdout' in error) ||
      typeof error.stdout !== 'string'
    ) {
      throw error;
    }
    ({ code } = error);
    output = {
      stderr: 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '',
      stdout: error.stdout,
    };
  }
  let report: DiagnosticsReport;
  try {
    report = JSON.parse(output.stdout);
  } catch (cause) {
    throw new Error(output.stderr?.trim() || 'Диагностика не вернула JSON-отчёт.', { cause });
  }
  const states: Record<string, string> = {
    Connecting: 'ожидание связи',
    Crashed: 'аварийное завершение',
    ok: 'готово',
  };
  for (const connection of report.checks.companion?.connections || []) {
    log(`${connection.label}: ${states[connection.status ?? ''] || connection.status}`);
  }
  if (report.checks.buttonReferences) {
    log(`Проверено ссылок кнопок: ${report.checks.buttonReferences.checked}`);
  }
  log(
    report.checks.obs?.available
      ? 'OBS: связь доступна, источники прочитаны.'
      : 'OBS: связь недоступна. Запустите OBS и повторите проверку.',
  );
  if (report.checks.companionStoredConnections?.matchesLive === false) {
    log(
      'ВНИМАНИЕ: настройки Companion на диске расходятся с работающей конфигурацией. Свежий штатный экспорт нужен до перезапуска.',
    );
  }
  log(
    (() => {
      if (code === 0) {
        return 'Проверенные связи готовы. Перед эфиром проверьте звук и изображение в OBS.';
      }
      if (code === 2) {
        return 'Есть предупреждения: готовность не подтверждена полностью.';
      }
      return 'Есть недоступные компоненты или ошибки. Готовность к эфиру не подтверждена.';
    })(),
  );
  log(`Подробный отчёт: ${reportFile}`);
  return code;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  runDiagnostics(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
