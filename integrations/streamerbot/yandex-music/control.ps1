param(
    [ValidateSet('status', 'play', 'pause', 'next', 'previous')]
    [string]$Command = 'status'
)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await-Operation($Operation, [Type]$ResultType) {
        $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
        if (-not $task.Wait(5000)) { throw 'Windows media control timed out.' }
        return $task.Result
    }
    $manager = Await-Operation ($managerType::RequestAsync()) $managerType
    $sessions = @($manager.GetSessions() | Where-Object {
        $_.SourceAppUserModelId -match '(?i)yandex[ ._-]*music|ru\.yandex\.desktop\.music|яндекс\s*музыка'
    })
    if ($sessions.Count -eq 0) {
        throw 'Yandex Music media session not found. Open the desktop app and start a track once.'
    }
    if ($sessions.Count -ne 1) { throw 'More than one Yandex Music session found; close the extra instance.' }
    $session = $sessions[0]
    if ($Command -eq 'status') {
        $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
        $media = Await-Operation ($session.TryGetMediaPropertiesAsync()) $propertiesType
        [pscustomobject]@{
            App = $session.SourceAppUserModelId
            Status = [string]$session.GetPlaybackInfo().PlaybackStatus
            Title = $media.Title
            Artist = $media.Artist
        } | ConvertTo-Json -Compress
        exit 0
    }
    $operation = switch ($Command) {
        'play' { $session.TryPlayAsync() }
        'pause' { $session.TryPauseAsync() }
        'next' { $session.TrySkipNextAsync() }
        'previous' { $session.TrySkipPreviousAsync() }
    }
    if (-not (Await-Operation $operation ([bool]))) { throw "Yandex Music rejected command: $Command" }
    Write-Output "Yandex Music: $Command accepted."
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
    exit 1
}
