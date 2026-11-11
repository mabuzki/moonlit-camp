$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$compilerRoot = Join-Path $desktopRoot 'output\bootstrap\portable-toolchain\msvc'
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (-not (Test-Path -LiteralPath (Join-Path $cargoBin 'cargo.exe'))) { throw 'Rust is not installed. Install the stable MSVC Rust toolchain first.' }
if (-not (Test-Path -LiteralPath (Join-Path $compilerRoot 'setup_x64.bat'))) { throw 'Portable MSVC/Windows SDK is not ready in output/bootstrap/portable-toolchain/msvc.' }
$compilerVersion = Get-ChildItem -Directory -LiteralPath (Join-Path $compilerRoot 'VC\Tools\MSVC') | Sort-Object Name | Select-Object -Last 1
$sdkVersion = Get-ChildItem -Directory -LiteralPath (Join-Path $compilerRoot 'Windows Kits\10\bin') | Sort-Object Name | Select-Object -Last 1
$vcPath = $compilerVersion.FullName
$sdkPath = Join-Path $compilerRoot 'Windows Kits\10'
$env:VSCMD_ARG_HOST_ARCH = 'x64'
$env:VSCMD_ARG_TGT_ARCH = 'x64'
$env:VCToolsVersion = $compilerVersion.Name
$env:VCToolsInstallDir = $vcPath + '\'
$env:VCINSTALLDIR = Join-Path $compilerRoot 'VC\'
$env:WindowsSdkDir = $sdkPath + '\'
$env:WindowsSdkBinPath = Join-Path $sdkPath 'bin\'
$env:WindowsSDKVersion = $sdkVersion.Name + '\'
$env:INCLUDE = @((Join-Path $vcPath 'include'),(Join-Path $sdkPath "Include\$($sdkVersion.Name)\ucrt"),(Join-Path $sdkPath "Include\$($sdkVersion.Name)\shared"),(Join-Path $sdkPath "Include\$($sdkVersion.Name)\um"),(Join-Path $sdkPath "Include\$($sdkVersion.Name)\winrt"),(Join-Path $sdkPath "Include\$($sdkVersion.Name)\cppwinrt")) -join ';'
$env:LIB = @((Join-Path $vcPath 'lib\x64'),(Join-Path $sdkPath "Lib\$($sdkVersion.Name)\ucrt\x64"),(Join-Path $sdkPath "Lib\$($sdkVersion.Name)\um\x64")) -join ';'
$env:PATH = @($cargoBin,(Join-Path $vcPath 'bin\Hostx64\x64'),(Join-Path $sdkPath "bin\$($sdkVersion.Name)\x64"),$env:PATH) -join ';'
