// Compile Action sources against installed DLLs; never load them.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOT_WRAPPER_THUNK_DOTDLL_RE = /\.(Wrapper|Thunk)\.dll$/;
const STREAMERDOTBOTDOT_TWITCH_NEWTONSOFT_YOUTUBE_RE =
  /^(Streamer\.bot\.|Twitch|Newtonsoft|YouTube)/;

const root = fileURLToPath(new URL('../../', import.meta.url));
const sources = {
  CategoryArtwork: [
    'integrations/streamerbot/droidcam/CategoryArtwork.cs',
    'integrations/streamerbot/droidcam/CameraPresentation.cs',
  ],
  ChatNotification: ['integrations/streamerbot/chat-sound/Action.cs'],
  DonationAlerts: [
    'integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs',
    'integrations/streamerbot/donationalerts/WebSocketMessages.cs',
  ],
  DonationAuthorization: ['integrations/streamerbot/donationalerts/DonationAlertsAuthorization.cs'],
  DonationGate: ['integrations/streamerbot/donationalerts/DonationGate.cs'],
  DonationToggle: [
    'integrations/streamerbot/donationalerts/DonationAlertsToggle.cs',
    'integrations/streamerbot/obs-health/CompanionEndpoint.cs',
  ],
  DonationWatcher: ['integrations/streamerbot/donationalerts/DonationAlertsWatcher.cs'],
  DroidCamToggle: [
    'integrations/streamerbot/droidcam/DroidCamToggle.cs',
    'integrations/streamerbot/droidcam/CameraPresentation.cs',
    'integrations/streamerbot/obs-health/CompanionEndpoint.cs',
  ],
  ModerationControl: ['integrations/streamerbot/donationalerts/ModerationControl.cs'],
  ModerationHost: [
    'integrations/streamerbot/donationalerts/ModerationEngine.cs',
    'integrations/streamerbot/donationalerts/ModerationFiles.cs',
    'integrations/streamerbot/donationalerts/ModerationOutput.cs',
    'integrations/streamerbot/donationalerts/ModerationHistory.cs',
    'integrations/streamerbot/donationalerts/ModerationWebServer.cs',
    'integrations/streamerbot/donationalerts/ModerationHost.cs',
  ],
  ModerationUI: ['integrations/streamerbot/donationalerts/ModerationUI.cs'],
  ObsHealth: [
    'integrations/streamerbot/obs-health/Check.cs',
    'integrations/streamerbot/obs-health/CompanionEndpoint.cs',
    'integrations/streamerbot/obs-health/AudioMeter.cs',
  ],
  ObsHealthSound: [
    'integrations/streamerbot/obs-health/SoundToggle.cs',
    'integrations/streamerbot/obs-health/CompanionEndpoint.cs',
  ],
  StreamInfo: [
    'apps/stream-info/streamerbot/action.cs',
    'apps/stream-info/streamerbot/state-cache-policy.cs',
    'apps/stream-info/streamerbot/category-search-transport.cs',
    'apps/stream-info/streamerbot/category-search-service.cs',
    'apps/stream-info/streamerbot/category-search-policy.cs',
  ],
};
const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
if (!process.env.STREAMERBOT_ROOT) {
  throw new Error('Set STREAMERBOT_ROOT to the mounted Streamer.bot directory');
}
const installed = realpathSync(process.env.STREAMERBOT_ROOT);
const references = readdirSync(installed).filter(
  (name) =>
    name.endsWith('.dll') &&
    STREAMERDOTBOTDOT_TWITCH_NEWTONSOFT_YOUTUBE_RE.test(name) &&
    !DOT_WRAPPER_THUNK_DOTDLL_RE.test(name),
);
if (!references.includes('Streamer.bot.Plugin.Interface.dll')) {
  throw new Error('Streamer.bot.Plugin.Interface.dll is missing');
}
const staging = mkdtempSync(join(tmpdir(), 'streamerbot-compile-'));
try {
  for (const [name, files] of Object.entries(sources)) {
    if (
      process.argv.includes('--only') &&
      !process.argv.slice(process.argv.indexOf('--only') + 1).includes(name)
    ) {
      continue;
    }
    const directory = join(staging, name);
    mkdirSync(directory);
    for (const [index, source] of files.entries()) {
      let text = readFileSync(join(root, source), 'utf8').replace(/^\uFEFF/, '');
      if (text.includes('public class CPHInline')) {
        text =
          'using Streamer.bot.Plugin.Interface;\n' +
          text.replaceAll('public class CPHInline', 'public class CPHInline : CPHInlineBase');
      }
      writeFileSync(join(directory, `${index}.cs`), text);
    }
    const items = references
      .map(
        (file) =>
          `<Reference Include="${escapeXml(basename(file, '.dll'))}"><HintPath>${escapeXml(join(installed, file))}</HintPath><Private>false</Private></Reference>`,
      )
      .join('');
    const project = join(directory, `${name}.csproj`);
    writeFileSync(
      project,
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net481</TargetFramework><LangVersion>latest</LangVersion><GenerateAssemblyInfo>false</GenerateAssemblyInfo></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="[1.0.3]" PrivateAssets="All" /><Reference Include="System.Web" /><Reference Include="System.Net.Http" /><Reference Include="System.Drawing" /><Reference Include="System.Windows.Forms" /><Reference Include="System.Security" /><Reference Include="Microsoft.CSharp" />' +
        items +
        '</ItemGroup></Project>',
    );
    execFileSync('dotnet', ['build', project, '--configuration', 'Release'], {
      stdio: 'inherit',
      timeout: 180_000,
    });
    console.log(`COMPILED ${name}`);
  }
} finally {
  rmSync(staging, { force: true, recursive: true });
}
