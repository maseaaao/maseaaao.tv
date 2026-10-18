$ErrorActionPreference = 'Stop'
$helper = Get-Process AudioHelper | Select-Object -First 1
$node = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'local-voice-stream-1' } | Select-Object -First 1
if (-not $helper -or -not $node) { throw 'target processes not found' }
$c1 = (Get-Process -Id $node.ProcessId).TotalProcessorTime.TotalSeconds
$h1 = $helper.TotalProcessorTime.TotalSeconds
$ram1 = (Get-Process -Id $node.ProcessId).WorkingSet64 / 1MB
Start-Sleep -Seconds 20
$c2 = (Get-Process -Id $node.ProcessId).TotalProcessorTime.TotalSeconds
$h2 = (Get-Process -Id $helper.Id).TotalProcessorTime.TotalSeconds
$ram2 = (Get-Process -Id $node.ProcessId).WorkingSet64 / 1MB
$hram = (Get-Process -Id $helper.Id).WorkingSet64 / 1MB
@(
 [ordered]@{ Process = 'AudioHelper'; CPUSecondsIn20s = [math]::Round($h2 - $h1, 4); OneCorePercent = [math]::Round(($h2 - $h1) / 20 * 100, 3); RAM_MB = [math]::Round($hram, 1) },
 [ordered]@{ Process = 'node (module host)'; CPUSecondsIn20s = [math]::Round($c2 - $c1, 4); OneCorePercent = [math]::Round(($c2 - $c1) / 20 * 100, 3); RAM_MB = [math]::Round($ram2, 1) }
) | ConvertTo-Json | Set-Content performance-1.0.5.json -Encoding UTF8
Get-Content performance-1.0.5.json
