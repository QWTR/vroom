# Po jeździe: podłącz telefon i uruchom (ten sam flow co wcześniej).
#
#   cd d:\VROOM\vroom\scripts
#   .\adb-dump-vroom-logs.ps1
#
# Ręcznie (jak używałeś):
#   D:\Android\Sdk\platform-tools\adb.exe logcat -d -v time | findstr /C:"[VROOM-TEL]" > vroom_telemetry_logcat.txt

$adb = "D:\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
  Write-Host "Brak: $adb"
  exit 1
}

$out = Join-Path $PSScriptRoot ("vroom_telemetry_logcat-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
Write-Host "ADB: $adb"
& $adb devices
Write-Host "Zrzut logcat -> $out"
Write-Host "Filtr: [VROOM-TEL] (NAV_TRACE, GPS, SNAP, jazda)"
Write-Host ""

& $adb logcat -d -v time 2>&1 | findstr /C:"[VROOM-TEL]" | Out-File -FilePath $out -Encoding utf8

$lines = @(Get-Content $out -ErrorAction SilentlyContinue)
Write-Host "Linii: $($lines.Count)"
if ($lines.Count -eq 0) {
  Write-Host "PUSTO — sprawdz:"
  Write-Host "  1) eas update z nowym kodem (NAV_TRACE idzie jako [VROOM-TEL])"
  Write-Host "  2) tryb jazdy byl wlaczony przed jazda"
  Write-Host "  3) nie robiles 'adb logcat -c' przed jazda (czysci bufor)"
  Write-Host "  4) zapas: .\adb-pull-nav-logs.ps1 (plik Download)"
  exit 1
}

Write-Host "--- ostatnie 35 linii ---"
$lines | Select-Object -Last 35
Write-Host "--- pelny plik: $out ---"
