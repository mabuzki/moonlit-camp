param([switch]$Release)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop-env.ps1')
Push-Location $desktopRoot
try {
    if ($Release) { pnpm.cmd exec tauri build --no-bundle }
    else { pnpm.cmd exec tauri build --debug --no-bundle }
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed ($LASTEXITCODE)." }
    $profile = if ($Release) { 'release' } else { 'debug' }
    $builtExe = Join-Path $desktopRoot "src-tauri\target\$profile\moonlit-camp.exe"
    $deliveryDir = Join-Path $desktopRoot 'output\desktop-build'
    New-Item -ItemType Directory -Force -Path $deliveryDir | Out-Null
    Copy-Item -LiteralPath $builtExe -Destination (Join-Path $deliveryDir 'MoonlitCamp.exe')
    Write-Output (Join-Path $deliveryDir 'MoonlitCamp.exe')
} finally { Pop-Location }
