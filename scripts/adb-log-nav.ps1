# Po jeździe: .\adb-dump-vroom-logs.ps1  (findstr [VROOM-TEL])
# Ten skrypt = szybki podgląd bufora (VROOM-TEL + stary VROOM-GPS).
$adb = "D:\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
  Write-Host "Brak: $adb"
  exit 1
}
Write-Host "ADB: $adb"
& $adb devices
$out = Join-Path $PSScriptRoot ("nav-adb-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
Write-Host "Zapis: $out"
& $adb logcat -d -t 2000 -s ReactNativeJS:* |
  Select-String -Pattern "VROOM-TEL|VROOM-GPS|NAV_TRACE|SNAP_|WORKLET|ERROR|FATAL" |
  Out-File -FilePath $out -Encoding utf8
$lines = @(Get-Content $out -ErrorAction SilentlyContinue)
Write-Host "Gotowe. Linii: $($lines.Count)"
if ($lines.Count -eq 0) {
  Write-Host "Pusto — otworz VROOM, wlacz tryb jazdy, potem uruchom skrypt ponownie."
}
