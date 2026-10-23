param(
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'maseaaao.tv\runtime'),
    [switch]$Apply
)
& (Join-Path $PSScriptRoot 'Update-Releases.ps1') -Root $Root -All -Apply:$Apply
exit $LASTEXITCODE
