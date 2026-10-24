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

const root = fileURLToPath(new URL('../../', import.meta.url));
const sources = {
  ChatNotification: ['integrations/streamerbot/chat-sound/Action.cs'],
  YandexMusic: ['integrations/streamerbot/yandex-music/Action.cs'],
  DonationWatcher: ['integrations/streamerbot/donationalerts/DonationAlertsWatcher.cs'],
  DonationAlerts: [
    'integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs',
    'integrations/streamerbot/donationalerts/WebSocketMessages.cs',
  ],
  DonationAuthorization: ['integrations/streamerbot/donationalerts/DonationAlertsAuthorization.cs'],
  DonationChat: ['integrations/streamerbot/donationalerts/DonationChat.cs'],
  ObsHealth: [
    'integrations/streamerbot/obs-health/Check.cs',
    'integrations/streamerbot/obs-health/CompanionEndpoint.cs',
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
const escapeXml = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
if (!process.env.STREAMERBOT_ROOT)
  throw new Error('Set STREAMERBOT_ROOT to the mounted Streamer.bot directory');
const installed = realpathSync(process.env.STREAMERBOT_ROOT);
const references = readdirSync(installed).filter(
  (name) =>
    name.endsWith('.dll') &&
    /^(Streamer\.bot\.|Twitch|Newtonsoft|YouTube)/.test(name) &&
    !/\.(Wrapper|Thunk)\.dll$/.test(name),
);
if (!references.includes('Streamer.bot.Plugin.Interface.dll'))
  throw new Error('Streamer.bot.Plugin.Interface.dll is missing');
const staging = mkdtempSync(join(tmpdir(), 'streamerbot-compile-'));
try {
  for (const [name, files] of Object.entries(sources)) {
    const directory = join(staging, name);
    mkdirSync(directory);
    for (const [index, source] of files.entries()) {
      let text = readFileSync(join(root, source), 'utf8').replace(/^\uFEFF/, '');
      if (text.includes('public class CPHInline'))
        text =
          'using Streamer.bot.Plugin.Interface;\n' +
          text.replaceAll('public class CPHInline', 'public class CPHInline : CPHInlineBase');
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
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net481</TargetFramework><LangVersion>latest</LangVersion><GenerateAssemblyInfo>false</GenerateAssemblyInfo></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="[1.0.3]" PrivateAssets="All" /><Reference Include="System.Web" /><Reference Include="System.Net.Http" /><Reference Include="Microsoft.CSharp" />' +
        items +
        '</ItemGroup></Project>',
    );
    execFileSync('dotnet', ['build', project, '--configuration', 'Release'], {
      stdio: 'inherit',
      timeout: 180000,
    });
    console.log(`COMPILED ${name}`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
