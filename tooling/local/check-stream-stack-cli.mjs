// Human-readable diagnostics wrapper. The underlying checker keeps its JSON interface.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function runDiagnostics(
  argv,
  { env = process.env, runFile = execute, log = console.log } = {},
) {
  let root = env.STREAMERBOT_ROOT;
  for (let index = 0; index < argv.length; index++) {
    if (!['--streamerbot-root', '-StreamerbotRoot'].includes(argv[index]))
      throw new Error(`Unknown argument: ${argv[index]}`);
    root = argv[++index];
    if (!root || root.startsWith('-')) throw new Error('Missing StreamerbotRoot directory.');
  }
  root = path.resolve(root?.trim() || path.resolve(import.meta.dirname, '../../../Streamer.bot'));
  const reportFile = path.join(root, 'custom/maintenance/stream-stack-latest.json');
  log('Проверка Streamer.bot, Companion и OBS. Все три приложения должны быть запущены.');
  let output;
  let code = 0;
  try {
    output = await runFile(
      process.execPath,
      [fileURLToPath(new URL('./check-stream-stack.mjs', import.meta.url)), '--report', reportFile],
      {
        env: { ...env, STREAMERBOT_ROOT: root },
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  } catch (error) {
    if (![1, 2].includes(error.code)) throw error;
    code = error.code;
    output = error;
  }
  let report;
  try {
    report = JSON.parse(output.stdout);
  } catch {
    throw new Error(output.stderr?.trim() || 'Диагностика не вернула JSON-отчёт.');
  }
  const states = { ok: 'готово', Connecting: 'ожидание связи', Crashed: 'аварийное завершение' };
  for (const connection of report.checks.companion?.connections || [])
    log(`${connection.label}: ${states[connection.status] || connection.status}`);
  if (report.checks.buttonReferences)
    log(`Проверено ссылок кнопок: ${report.checks.buttonReferences.checked}`);
  log(
    report.checks.obs?.available
      ? 'OBS: связь доступна, источники прочитаны.'
      : 'OBS: связь недоступна. Запустите OBS и повторите проверку.',
  );
  if (report.checks.companionStoredConnections?.matchesLive === false)
    log(
      'ВНИМАНИЕ: настройки Companion на диске расходятся с работающей конфигурацией. Свежий штатный экспорт нужен до перезапуска.',
    );
  log(
    code === 0
      ? 'Проверенные связи готовы. Перед эфиром проверьте звук и изображение в OBS.'
      : code === 2
        ? 'Есть предупреждения: готовность не подтверждена полностью.'
        : 'Есть недоступные компоненты или ошибки. Готовность к эфиру не подтверждена.',
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
