import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtime = process.env.COMPANION_NODE_BIN;
if (!runtime) {
  throw new Error(
    'Set COMPANION_NODE_BIN to Companion bundled Node.js for this import-only check.',
  );
}
const probe = `
const entrypoint = await import(process.argv[1]);
if (typeof entrypoint.default !== 'function') throw new Error('Companion requires a default constructor, not a CommonJS namespace object');
if (!Array.isArray(entrypoint.UpgradeScripts)) throw new Error('UpgradeScripts must be an array');
console.log('PASS: native loader sees a default constructor and upgrade scripts; init was not called.');
`;
for (const product of ['system-microphone', 'voice-control']) {
  const file = fileURLToPath(
    new URL(`../../../dist/companion/${product}/main.js`, import.meta.url),
  );
  const output = execFileSync(
    runtime,
    ['--input-type=module', '-e', probe, pathToFileURL(file).href],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    },
  );
  console.log(`${product}: ${output.trim()}`);
}
