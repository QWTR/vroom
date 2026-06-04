# NA ŻYWO z kablem.
# Po jeździe: .\adb-dump-vroom-logs.ps1  (findstr [VROOM-TEL])
# ADB: D:\Android\Sdk\platform-tools\adb.exe

function Resolve-Adb {
  $candidates = @(
    $env:ADB,
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "D:\Android\Sdk\platform-tools\adb.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count -gt 0) { return $candidates[0] }
  $cmd = Get-Command adb -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$adb = Resolve-Adb
if (-not $adb) {
  Write-Host "Brak adb. winget install Google.PlatformTools"
  exit 1
}

$out = Join-Path $PSScriptRoot ("nav-trace-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
Write-Host "ADB: $adb"
Write-Host "Zapis do: $out"
Write-Host "Filtr: [VROOM-TEL]"
Write-Host "Ctrl+C aby zakonczyc."

& $adb logcat -c
& $adb logcat -s ReactNativeJS:* |
  Select-String -Pattern "VROOM-TEL" |
  Tee-Object -FilePath $out
