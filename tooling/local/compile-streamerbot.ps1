$ErrorActionPreference='Stop'
if (-not $env:STREAMERBOT_ROOT) { throw 'Set STREAMERBOT_ROOT to the installed Streamer.bot directory' }
$root=[IO.Path]::GetFullPath($env:STREAMERBOT_ROOT)
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$output=Join-Path ([IO.Path]::GetTempPath()) 'maseaaao-streamerbot-compile'
New-Item -ItemType Directory -Force -Path $output|Out-Null
$sdk=Get-ChildItem 'C:\Program Files\dotnet\sdk' -Directory|Sort-Object Name -Descending|Select-Object -First 1
$compiler=Join-Path $sdk.FullName 'Roslyn\bincore\csc.dll'
$framework='C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8.1'
$references=@(Get-ChildItem $framework -Filter '*.dll'; Get-Item (Join-Path $framework 'Facades\netstandard.dll'))
$references+=Get-ChildItem $root -Filter '*.dll'|Where-Object Name -match '^(Streamer\.bot\.|Twitch|Newtonsoft|YouTube)'
$references=@($references|Where-Object {$_.Name -notmatch '\.(Wrapper|Thunk)\.dll$'})
$refArgs=@($references|ForEach-Object {'/reference:'+$_.FullName})
$sources=@{
 ChatNotification=@('integrations/streamerbot/chat-sound/Action.cs')
 YandexMusic=@('integrations/streamerbot/yandex-music/Action.cs')
 DonationWatcher=@('integrations/streamerbot/donationalerts/DonationAlertsWatcher.cs')
 DonationAlerts=@('integrations/streamerbot/donationalerts/DonationAlertsIntegration.cs','integrations/streamerbot/donationalerts/WebSocketMessages.cs')
 DonationAuthorization=@('integrations/streamerbot/donationalerts/DonationAlertsAuthorization.cs')
 DonationChat=@('integrations/streamerbot/donationalerts/DonationChat.cs')
 ObsHealth=@('integrations/streamerbot/obs-health/Check.cs','integrations/streamerbot/obs-health/CompanionEndpoint.cs')
 ObsHealthSound=@('integrations/streamerbot/obs-health/SoundToggle.cs','integrations/streamerbot/obs-health/CompanionEndpoint.cs')
 StreamInfo=@('apps/stream-info/streamerbot/action.cs','apps/stream-info/streamerbot/state-cache-policy.cs','apps/stream-info/streamerbot/category-search-transport.cs','apps/stream-info/streamerbot/category-search-service.cs','apps/stream-info/streamerbot/category-search-policy.cs')
}
foreach($entry in $sources.GetEnumerator()){
  $files=@()
  foreach($relative in $entry.Value){
    $source=[IO.File]::ReadAllText((Join-Path $sourceRoot $relative))
    if($source.Contains('public class CPHInline')){
      $source="using Streamer.bot.Plugin.Interface;`n"+$source.Replace('public class CPHInline','public class CPHInline : CPHInlineBase')
    }
    $target=Join-Path $output ($entry.Key+'-'+[IO.Path]::GetFileName($relative))
    [IO.File]::WriteAllText($target,$source,[Text.UTF8Encoding]::new($false));$files+=$target
  }
  & dotnet $compiler /nologo /target:library /langversion:latest /nostdlib+ ('/out:'+(Join-Path $output ($entry.Key+'.dll'))) @refArgs @files
  if($LASTEXITCODE -ne 0){throw ('Compilation failed: '+$entry.Key)}
  Write-Output ('COMPILED '+$entry.Key)
}
