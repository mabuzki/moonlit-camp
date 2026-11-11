$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopExe = Join-Path $desktopRoot 'output\desktop-build\MoonlitCamp.exe'
if (-not (Test-Path -LiteralPath $desktopExe)) { & (Join-Path $PSScriptRoot 'build-desktop.ps1') }
$runningCamp = Get-Process -Name 'MoonlitCamp' -ErrorAction SilentlyContinue | Where-Object Path -eq $desktopExe
if (-not $runningCamp) {
    Start-Process -FilePath $desktopExe -WorkingDirectory $desktopRoot -WindowStyle Normal
}
