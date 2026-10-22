param([string]$StreamerbotRoot = $env:STREAMERBOT_ROOT)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($StreamerbotRoot)) { $StreamerbotRoot = Join-Path $PSScriptRoot '../../../Streamer.bot' }
$env:STREAMERBOT_ROOT = [IO.Path]::GetFullPath($StreamerbotRoot)
$runtimeRoot = Join-Path $env:ProgramFiles 'Companion\resources\node-runtimes'
$runtime = @('node22','node26') | ForEach-Object { Join-Path $runtimeRoot "$_\node.exe" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $runtime) { $runtime = (Get-Command node -ErrorAction Stop).Source }
Write-Host 'Проверка Streamer.bot, Companion и OBS. Все три приложения должны быть запущены.'
$raw = & $runtime --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'check-stream-stack.mjs') --report (Join-Path $env:STREAMERBOT_ROOT 'custom/maintenance/stream-stack-latest.json')
$result = $LASTEXITCODE
$report = ($raw -join "`n") | ConvertFrom-Json
foreach ($connection in $report.checks.companion.connections) {
    $state = switch ($connection.status) { 'ok' { 'готово' } 'Connecting' { 'ожидание связи' } 'Crashed' { 'аварийное завершение' } default { $connection.status } }
    Write-Host "$($connection.label): $state"
}
if ($report.checks.buttonReferences) { Write-Host "Проверено ссылок кнопок: $($report.checks.buttonReferences.checked)" }
if ($report.checks.obs.available) { Write-Host 'OBS: связь доступна, источники прочитаны.' } else { Write-Host 'OBS: связь недоступна. Запустите OBS и повторите проверку.' }
if ($report.checks.companionStoredConnections.matchesLive -eq $false) { Write-Host 'ВНИМАНИЕ: настройки Companion на диске расходятся с работающей конфигурацией. Свежий штатный экспорт нужен до перезапуска.' }
if ($result -eq 0) { Write-Host 'Проверенные связи готовы. Перед эфиром проверьте звук и изображение в OBS.' }
elseif ($result -eq 2) { Write-Host 'Есть предупреждения: готовность не подтверждена полностью.' }
else { Write-Host 'Есть недоступные компоненты или ошибки. Готовность к эфиру не подтверждена.' }
Write-Host "Подробный отчёт: $(Join-Path $env:STREAMERBOT_ROOT 'custom/maintenance/stream-stack-latest.json')"
exit $result
