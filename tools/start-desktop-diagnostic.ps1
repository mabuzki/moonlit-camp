$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopExe = Join-Path $desktopRoot 'output\desktop-build\MoonlitCamp.exe'
$runtimeDir = Join-Path $desktopRoot 'output\runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$portReservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$portReservation.Start()
$debugPort = $portReservation.LocalEndpoint.Port
$portReservation.Stop()
$previousWebviewArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "$previousWebviewArgs --remote-debugging-port=$debugPort".Trim()
    $diagnosticProcess = Start-Process -FilePath $desktopExe -WorkingDirectory $desktopRoot -WindowStyle Normal -RedirectStandardOutput (Join-Path $runtimeDir 'desktop.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'desktop.stderr.log') -PassThru
    [pscustomobject]@{pid=$diagnosticProcess.Id;debugPort=$debugPort;exe=$desktopExe} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'desktop-diagnostic.json')
    [pscustomobject]@{pid=$diagnosticProcess.Id;debugPort=$debugPort;exe=$desktopExe} | ConvertTo-Json -Compress
} finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebviewArgs }
