# NA ŻYWO z kablem.
# Po jeździe: .\adb-dump-vroom-logs.ps1  (findstr [VROOM-TEL])
# ADB: D:\Android\Sdk\platform-tools\adb.exe

$adb = "D:\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
  Write-Host "Brak: $adb"
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
