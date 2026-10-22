param(
    [switch]$OpenAdmin,
    [string]$StreamerbotRoot = $env:STREAMERBOT_ROOT
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($StreamerbotRoot)) {
    $StreamerbotRoot = Join-Path $PSScriptRoot '../../../Streamer.bot'
}
$configDirectory = Join-Path $StreamerbotRoot 'custom/companion/data'
$configFile = Join-Path $configDirectory 'config.json'
$machineIdFile = Join-Path $configDirectory 'machid'
$companionInstall = Join-Path $env:ProgramFiles 'Companion'
$resourcesDirectory = Join-Path $companionInstall 'resources'
$mainScript = Join-Path $resourcesDirectory 'main.js'

foreach ($requiredPath in @($configDirectory, $configFile, $machineIdFile, $mainScript)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Companion path is missing: $requiredPath"
    }
}

$nodeRuntime = Get-ChildItem -LiteralPath (Join-Path $resourcesDirectory 'node-runtimes') -Directory -ErrorAction Stop |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
    Sort-Object { if ($_.Name -match '(\d+)$') { [int]$Matches[1] } else { 0 } } -Descending |
    Select-Object -First 1

if ($null -eq $nodeRuntime) {
    throw "Companion's bundled Node.js runtime was not found in $resourcesDirectory"
}

$nodeExecutable = Join-Path $nodeRuntime.FullName 'node.exe'
$configuration = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$machineId = (Get-Content -LiteralPath $machineIdFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($machineId)) {
    throw 'Companion machine id is empty.'
}

$adminPort = [int]$configuration.http_port
$adminAddress = [string]$configuration.bind_ip
if ([string]::IsNullOrWhiteSpace($adminAddress)) {
    $adminAddress = '0.0.0.0'
}
$probeAddress = if ($adminAddress -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $adminAddress }
$adminUri = "http://$probeAddress`:$adminPort/"

function Get-RunningCompanionProcess {
    foreach ($candidate in @(Get-Process -Name 'node' -ErrorAction SilentlyContinue)) {
        try {
            $candidatePath = [string]$candidate.Path
            if (-not [string]::IsNullOrWhiteSpace($candidatePath) -and
                $candidatePath.StartsWith($companionInstall, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $candidate
            }
        }
        catch {
            # A process can disappear or deny access while it is being inspected.
        }
    }

    return $null
}

function Test-CompanionAdminEndpoint {
    try {
        $response = Invoke-WebRequest -Uri $adminUri -UseBasicParsing -TimeoutSec 2
        return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

$runningCompanion = Get-RunningCompanionProcess
if ($null -ne $runningCompanion) {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-CompanionAdminEndpoint) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $ready) {
        throw "Companion process $($runningCompanion.Id) is already running, but $adminUri did not become ready within 10 seconds. A second instance was not started."
    }

    if ($OpenAdmin) {
        Start-Process -FilePath $adminUri -WindowStyle Hidden
    }
    Write-Output "Companion is already running (PID $($runningCompanion.Id), $adminAddress`:$adminPort)."
    exit 0
}

if ($null -eq $runningCompanion -and (Test-CompanionAdminEndpoint)) {
    throw "Address $adminAddress`:$adminPort is already served by another process. Companion was not started."
}

$arguments = New-Object System.Collections.Generic.List[string]
$arguments.Add('--use-system-ca')
$arguments.Add($mainScript)
$arguments.Add("--machine-id=$machineId")
$arguments.Add("--config-dir=$configDirectory")
$arguments.Add("--admin-port=$adminPort")
$arguments.Add("--admin-address=$adminAddress")

if (-not [string]::IsNullOrWhiteSpace([string]$configuration.log_level)) {
    $arguments.Add("--log-level=$($configuration.log_level)")
}
if ($configuration.enable_shell_command_support) {
    $arguments.Add('--enable-shell-command-support')
}
if ($configuration.enable_restricted_modules) {
    $arguments.Add('--enable-restricted-modules')
}
if (-not [string]::IsNullOrWhiteSpace([string]$configuration.trusted_proxies)) {
    $arguments.Add("--trusted-proxies=$($configuration.trusted_proxies)")
}
if ($configuration.enable_developer -and -not [string]::IsNullOrWhiteSpace([string]$configuration.dev_modules_path)) {
    $arguments.Add("--extra-module-path=$($configuration.dev_modules_path)")
}
if ($configuration.enable_syslog) {
    $arguments.Add('--syslog-enable')
    $arguments.Add("--syslog-host=$($configuration.syslog_host)")
    $arguments.Add("--syslog-port=$($configuration.syslog_port)")
    if ($configuration.syslog_use_tcp) {
        $arguments.Add('--syslog-tcp')
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$configuration.syslog_local_hostname)) {
        $arguments.Add("--syslog-localhost=$($configuration.syslog_local_hostname)")
    }
}

function Quote-ProcessArgument([string]$Value) {
    return '"' + $Value.Replace('"', '\"') + '"'
}

$argumentLine = ($arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' '
$process = Start-Process -FilePath $nodeExecutable `
    -ArgumentList $argumentLine `
    -WorkingDirectory $resourcesDirectory `
    -WindowStyle Hidden `
    -PassThru

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($process.HasExited) {
        throw "Companion exited during startup with code $($process.ExitCode)."
    }
    $ready = Test-CompanionAdminEndpoint
    if ($ready) {
        break
    }
}

if (-not $ready) {
    throw "Companion process $($process.Id) started, but $probeAddress`:$adminPort did not become reachable within 15 seconds."
}

if ($OpenAdmin) {
    Start-Process -FilePath $adminUri -WindowStyle Hidden
}

Write-Output "Companion started with portable configuration (PID $($process.Id), $adminAddress`:$adminPort)."
