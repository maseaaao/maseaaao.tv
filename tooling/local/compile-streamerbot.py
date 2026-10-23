"""Compile Action sources against installed Streamer.bot DLLs; never load them.

Run from Linux/WSL2 with STREAMERBOT_ROOT set to the mounted installation.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {'ChatNotification': ['integrations/streamerbot/chat-sound/Action.cs'],
 'YandexMusic': ['integrations/streamerbot/yandex-music/Action.cs'],
 'DonationWatcher': ['integrations/streamerbot/donationalerts/DonationAlertsWatcher.cs'],
 'DonationAlerts': ['integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs',
                    'integrations/streamerbot/donationalerts/WebSocketMessages.cs'],
 'DonationAuthorization': ['integrations/streamerbot/donationalerts/DonationAlertsAuthorization.cs'],
 'DonationChat': ['integrations/streamerbot/donationalerts/DonationChat.cs'],
 'ObsHealth': ['integrations/streamerbot/obs-health/Check.cs',
               'integrations/streamerbot/obs-health/CompanionEndpoint.cs'],
 'ObsHealthSound': ['integrations/streamerbot/obs-health/SoundToggle.cs',
                    'integrations/streamerbot/obs-health/CompanionEndpoint.cs'],
 'StreamInfo': ['apps/stream-info/streamerbot/action.cs',
                'apps/stream-info/streamerbot/state-cache-policy.cs',
                'apps/stream-info/streamerbot/category-search-transport.cs',
                'apps/stream-info/streamerbot/category-search-service.cs',
                'apps/stream-info/streamerbot/category-search-policy.cs']}


def main():
    configured = os.environ.get('STREAMERBOT_ROOT')
    if not configured:
        raise SystemExit('Set STREAMERBOT_ROOT to the mounted Streamer.bot directory')
    installed = Path(configured).resolve(strict=True)
    references = [p for p in installed.glob('*.dll')
                  if re.match(r'^(Streamer\.bot\.|Twitch|Newtonsoft|YouTube)', p.name)
                  and not re.search(r'\.(Wrapper|Thunk)\.dll$', p.name)]
    if not any(p.name == 'Streamer.bot.Plugin.Interface.dll' for p in references):
        raise SystemExit('Streamer.bot.Plugin.Interface.dll is missing')
    with tempfile.TemporaryDirectory(prefix='streamerbot-compile-') as temporary:
        staging = Path(temporary)
        for name, sources in SOURCES.items():
            directory = staging / name
            directory.mkdir()
            for index, source in enumerate(sources):
                text = (ROOT / source).read_text(encoding='utf-8-sig')
                if 'public class CPHInline' in text:
                    text = 'using Streamer.bot.Plugin.Interface;\n' + text.replace(
                        'public class CPHInline', 'public class CPHInline : CPHInlineBase')
                (directory / f'{index}.cs').write_text(text, encoding='utf-8')
            items = ''.join('<Reference Include="' + escape(p.stem, {'"': '&quot;'})
                            + '"><HintPath>' + escape(str(p))
                            + '</HintPath><Private>false</Private></Reference>' for p in references)
            project = directory / (name + '.csproj')
            project.write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                               '<TargetFramework>net481</TargetFramework>'
                               '<LangVersion>latest</LangVersion>'
                               '<GenerateAssemblyInfo>false</GenerateAssemblyInfo>'
                               '</PropertyGroup><ItemGroup>'
                               '<PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" '
                               'Version="[1.0.3]" PrivateAssets="All" />'
                               + '<Reference Include="System.Web" /><Reference Include="System.Net.Http" />'
                               + '<Reference Include="Microsoft.CSharp" />'
                               + items + '</ItemGroup></Project>', encoding='utf-8')
            subprocess.run(['dotnet', 'build', str(project), '--configuration', 'Release'],
                           check=True, timeout=180)
            print('COMPILED ' + name, flush=True)


if __name__ == '__main__':
    main()
