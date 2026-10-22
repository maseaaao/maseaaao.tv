param([Parameter(Mandatory=$true)][string]$ModuleDirectory,[Parameter(Mandatory=$true)][string]$Name,[switch]$Json)
$ErrorActionPreference='Stop'
$companionRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$moduleRoot=[IO.Path]::GetFullPath($ModuleDirectory).TrimEnd('\','/')
if ($moduleRoot -notin @((Join-Path $companionRoot 'system-microphone'),(Join-Path $companionRoot 'voice-control'))) { throw 'Unexpected module directory' }
$libraryRoot=Join-Path $PSScriptRoot 'lib'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$libraries=@('NAudio.Core.dll','NAudio.Wasapi.dll')
if($Json){$libraries+='Newtonsoft.Json.dll'}
$arguments=@('/nologo','/target:exe','/optimize+','/platform:x64',('/out:'+(Join-Path $moduleRoot ($Name+'.exe'))))
$netstandard=Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\netstandard\v4.0_2.0.0.0__cc7b13ffcd2ddd51\netstandard.dll'
$arguments+=('/reference:'+$netstandard)
foreach($library in $libraries){
  $source=Join-Path $libraryRoot $library
  if (-not (Test-Path -LiteralPath $source)) { throw 'Run pnpm run prepare:companion-libs first' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $moduleRoot $library) -Force
  $arguments+=('/reference:'+$source)
}
$arguments+=(Join-Path $moduleRoot ($Name+'.cs'))
& $compiler @arguments
if($LASTEXITCODE -ne 0){throw 'C# helper compilation failed'}
