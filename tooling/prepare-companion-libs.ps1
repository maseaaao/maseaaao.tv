$ErrorActionPreference='Stop'
$libraryRoot=Join-Path $PSScriptRoot '../integrations/companion/shared/lib'
New-Item -ItemType Directory -Path $libraryRoot -Force | Out-Null
$packages=@(
    @{Id='naudio.core';Version='2.2.1';File='lib/netstandard2.0/NAudio.Core.dll'},
    @{Id='naudio.wasapi';Version='2.2.1';File='lib/netstandard2.0/NAudio.Wasapi.dll'},
    @{Id='newtonsoft.json';Version='13.0.3';File='lib/net45/Newtonsoft.Json.dll'}
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach($package in $packages) {
    $archive=Join-Path $libraryRoot ($package.Id+'.nupkg')
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$($package.Id)/$($package.Version)/$($package.Id).$($package.Version).nupkg" -OutFile $archive -TimeoutSec 60
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $entry=$zip.GetEntry($package.File)
        if(-not $entry){throw "Missing library: $($package.File)"}
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $libraryRoot ([IO.Path]::GetFileName($package.File))),$true)
    } finally {$zip.Dispose()}
}
Write-Output 'Pinned build libraries prepared; no installed application libraries were modified.'
