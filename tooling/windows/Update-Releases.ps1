param(
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'maseaaao.tv\runtime'),
    [string]$Product,
    [string]$Version,
    [string]$Rollback,
    [switch]$All,
    [switch]$Recover,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$modes = @($All.IsPresent, [bool]$Product, [bool]$Rollback, $Recover.IsPresent) | Where-Object { $_ }
if ($modes.Count -gt 1) { throw 'Choose one of -All, -Product, -Rollback or -Recover.' }
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonPrefix = @()
if (-not $pythonCommand) {
    $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
    $pythonPrefix = @('-3')
}
if (-not $pythonCommand) { throw 'Install Python 3.10 or newer for Windows. No pip packages are required.' }
& $pythonCommand.Source @pythonPrefix -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or newer is required.' }
$arguments = @((Join-Path $PSScriptRoot 'update_releases.py'), '--root', $Root)
if ($Product) { $arguments += @('--product', $Product) }
elseif ($Rollback) { $arguments += @('--rollback', $Rollback) }
elseif ($Recover) { $arguments += '--recover' }
else { $arguments += '--all' }
if ($Version) { $arguments += @('--version', $Version) }
if ($Apply) { $arguments += '--apply' }
& $pythonCommand.Source @pythonPrefix @arguments
exit $LASTEXITCODE
