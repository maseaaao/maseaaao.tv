// Preserve the Windows runtime sources and Action files for manual import.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/windows-integrations/', root);
const files = [
  ['integrations/streamerbot/droidcam/CategoryArtwork.cs', 'actions/droidcam/CategoryArtwork.cs'],
  ['integrations/streamerbot/droidcam/DroidCamToggle.cs', 'actions/droidcam/DroidCamToggle.cs'],
  [
    'integrations/streamerbot/droidcam/CameraPresentation.cs',
    'actions/droidcam/CameraPresentation.cs',
  ],
  ['integrations/streamerbot/droidcam/cam-pug.jpg', 'actions/droidcam/cam-pug.jpg'],
  ['integrations/streamerbot/droidcam/README.md', 'actions/droidcam/README.md'],
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
    'integrations/streamerbot/donationalerts/DonationHandler_Default.cs',
    'actions/donationalerts/DonationHandler_Default.cs',
  ],
  ['integrations/streamerbot/donationalerts/LICENSE', 'actions/donationalerts/LICENSE'],
  ['integrations/streamerbot/donationalerts/README.md', 'actions/donationalerts/README.md'],
  [
    'integrations/streamerbot/donationalerts/WebSocketMessages.cs',
    'actions/donationalerts/WebSocketMessages.cs',
  ],
  ['integrations/streamerbot/stream-deck/StreamToggle.cs', 'actions/stream-deck/StreamToggle.cs'],
  ['integrations/streamerbot/stream-deck/RecordToggle.cs', 'actions/stream-deck/RecordToggle.cs'],
  ['integrations/streamerbot/stream-deck/ReplaySave.cs', 'actions/stream-deck/ReplaySave.cs'],
  ['integrations/streamerbot/stream-deck/VodStudio.cs', 'actions/stream-deck/VodStudio.cs'],
  ['integrations/streamerbot/vod/VodLifecycle.cs', 'actions/vod/VodLifecycle.cs'],
] as const;

rmSync(output, { force: true, recursive: true });
for (const [source, target] of files) {
  const destination = new URL(target, output);
  mkdirSync(dirname(fileURLToPath(destination)), { recursive: true });
  copyFileSync(new URL(source, root), destination);
}
await import('./local/build-camera-import.ts');
console.log(`Windows integrations: ${files.length} files → ${fileURLToPath(output)}`);
