// Preserve the Windows runtime sources and include the bundled storage diagnostic.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/windows-integrations/', root);
const files = [
  ['integrations/companion/start-companion.ts', 'start-companion.ts'],
  ['integrations/companion/companion-processes.wsf', 'companion-processes.wsf'],
  ['tooling/local/check-stream-stack-cli.ts', 'diagnostics/check-stream-stack-cli.ts'],
  ['tooling/local/check-stream-stack.ts', 'diagnostics/check-stream-stack.ts'],
  ['tooling/local/action-targets.ts', 'diagnostics/action-targets.ts'],
  ['tooling/local/companion-storage.ts', 'diagnostics/companion-storage.ts'],
  ['tooling/local/diagnostic-types.ts', 'diagnostics/diagnostic-types.ts'],
  ['dist/diagnostics/compare-companion-storage.mjs', 'diagnostics/compare-companion-storage.mjs'],
  ['tooling/windows/runtime-README.md', 'README.md'],
  ['integrations/streamerbot/chat-sound/Action.cs', 'actions/chat-sound/Action.cs'],
  ['integrations/streamerbot/chat-sound/notif.mp3', 'actions/chat-sound/notif.mp3'],
  [
    'integrations/streamerbot/donationalerts/DonationAlertsAuthorization.cs',
    'actions/donationalerts/DonationAlertsAuthorization.cs',
  ],
  [
    'integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs',
    'actions/donationalerts/DonationAlertsIntegration.cs',
  ],
  [
    'integrations/streamerbot/donationalerts/DonationAlertsWatcher.cs',
    'actions/donationalerts/DonationAlertsWatcher.cs',
  ],
  [
    'integrations/streamerbot/donationalerts/DonationAlertsToggle.cs',
    'actions/donationalerts/DonationAlertsToggle.cs',
  ],
  [
    'integrations/streamerbot/donationalerts/DonationChat.cs',
    'actions/donationalerts/DonationChat.cs',
  ],
  ['integrations/streamerbot/donationalerts/LICENSE', 'actions/donationalerts/LICENSE'],
  ['integrations/streamerbot/donationalerts/README.md', 'actions/donationalerts/README.md'],
  [
    'integrations/streamerbot/donationalerts/WebSocketMessages.cs',
    'actions/donationalerts/WebSocketMessages.cs',
  ],
  ['integrations/streamerbot/obs-health/Check.cs', 'actions/obs-health/Check.cs'],
  [
    'integrations/streamerbot/obs-health/health-warning.mp3',
    'actions/obs-health/health-warning.mp3',
  ],
  [
    'integrations/streamerbot/obs-health/CompanionEndpoint.cs',
    'actions/obs-health/CompanionEndpoint.cs',
  ],
  ['integrations/streamerbot/obs-health/SoundToggle.cs', 'actions/obs-health/SoundToggle.cs'],
] as const;

rmSync(output, { force: true, recursive: true });
for (const [source, target] of files) {
  const destination = new URL(target, output);
  mkdirSync(dirname(fileURLToPath(destination)), { recursive: true });
  copyFileSync(new URL(source, root), destination);
}
console.log(`Windows integrations: ${files.length} files → ${fileURLToPath(output)}`);
