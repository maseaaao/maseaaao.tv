$ErrorActionPreference='Stop'
$libraryRoot=Join-Path $PSScriptRoot '../integrations/companion/shared/lib'
New-Item -ItemType Directory -Path $libraryRoot -Force | Out-Null
$packages=@(
    @{Id='naudio.core';Version='2.2.1';File='lib/netstandard2.0/NAudio.Core.dll'},
    @{Id='naudio.wasapi';Version='2.2.1';File='lib/netstandard2.0/NAudio.Wasapi.dll'},
    @{Id='newtonsoft.json';Version='13.0.3';File='lib/net45/Newtonsoft.Json.dll'}
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Keep downloads and extraction away from the last successful set. Publish only
# after every pinned package has been downloaded and its required entry read.
$staging=Join-Path $libraryRoot ('.prepare-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach($package in $packages) {
        $archive=Join-Path $staging ($package.Id+'.nupkg')
        for($attempt=1;$attempt -le 3;$attempt++) {
            try {
                Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$($package.Id)/$($package.Version)/$($package.Id).$($package.Version).nupkg" -OutFile $archive -TimeoutSec 60
                $zip=[IO.Compression.ZipFile]::OpenRead($archive)
                try {
                    $entry=$zip.GetEntry($package.File)
                    if(-not $entry){throw "Missing library: $($package.File)"}
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $staging ([IO.Path]::GetFileName($package.File))),$true)
                } finally {$zip.Dispose()}
                break
            } catch {
                Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
                if($attempt -eq 3){throw}
                Write-Warning "Retrying $($package.Id) after attempt $attempt failed: $($_.Exception.Message)"
            }
        }
    }
    foreach($file in Get-ChildItem -LiteralPath $staging -File) {
        $destination=Join-Path $libraryRoot $file.Name
        if(Test-Path -LiteralPath $destination) {
            [IO.File]::Replace($file.FullName,$destination,(Join-Path $staging ($file.Name+'.previous')))
        } else {
            [IO.File]::Move($file.FullName,$destination)
        }
    }
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
Write-Output 'Pinned build libraries prepared; no installed application libraries were modified.'
