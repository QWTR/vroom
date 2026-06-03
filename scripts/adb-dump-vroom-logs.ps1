# Zrzut logów jazdy z telefonu (logcat + plik na dysku).
#
#   cd D:\VROOM\vroom\scripts
#   .\adb-dump-vroom-logs.ps1
#
# PRZED jazdą (opcjonalnie — czyści stary bufor logcat):
#   adb logcat -c
#
# WAŻNE: findstr z nawiasami [VROOM-TEL] w PowerShell często zwraca PUSTO!
# Używaj tego skryptu albo: findstr "VROOM-TEL" (bez nawiasów kwadratowych)

$adb = "adb"
if (Test-Path "D:\Android\Sdk\platform-tools\adb.exe") {
  $adb = "D:\Android\Sdk\platform-tools\adb.exe"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $PSScriptRoot "vroom_telemetry_logcat-$stamp.txt"

Write-Host "=== VROOM log dump ==="
Write-Host "ADB: $adb"
& $adb devices
Write-Host ""

$raw = & $adb logcat -d -v time 2>&1
# PowerShell Select-String — nie używaj findstr /C:"[VROOM-TEL]"
$matched = @($raw | Select-String -Pattern "VROOM-TEL")
$matched | ForEach-Object { $_.Line } | Out-File -FilePath $out -Encoding utf8

$count = $matched.Count
Write-Host "Linii VROOM-TEL w logcat: $count"
Write-Host "Plik: $out"

if ($count -eq 0) {
  Write-Host ""
  Write-Host "LOGCAT PUSTY. Możliwe przyczyny:"
  Write-Host "  1) adb logcat -c wyczyscilo bufor PRZED jazda"
  Write-Host "  2) Nie bylo jazdy / tryb jazdy nie wlaczony"
  Write-Host "  3) Stary build bez DRIVE_TRACE — zrob eas update"
  Write-Host ""
  Write-Host "Probuje plik z telefonu (nie zalezy od bufora logcat)..."
  & "$PSScriptRoot\adb-pull-drive-logs.ps1"
  exit 1
}

$ticks = @($matched | Select-String "DRIVE_TRACE_TICK")
$raws = @($matched | Select-String "DRIVE_TRACE_RAW")
$rejects = @($matched | Select-String "DRIVE_TRACE_REJECT")
$sessions = @($matched | Select-String "DRIVE_TRACE_SESSION")
$pings = @($matched | Select-String "DRIVE_TRACE_PING")

Write-Host ""
Write-Host "DRIVE_TRACE_TICK:    $($ticks.Count)"
Write-Host "DRIVE_TRACE_RAW:     $($raws.Count)"
Write-Host "DRIVE_TRACE_REJECT:  $($rejects.Count)"
Write-Host "DRIVE_TRACE_SESSION: $($sessions.Count)"
Write-Host "DRIVE_TRACE_PING:    $($pings.Count)"

Write-Host ""
Write-Host "--- sesje ---"
$sessions | Select-Object -Last 5 | ForEach-Object { $_.Line }

Write-Host ""
Write-Host "--- ostatnie 25 linii ---"
$matched | Select-Object -Last 25 | ForEach-Object { $_.Line }

Write-Host ""
Write-Host "Pelny plik: $out"
Write-Host ""
Write-Host "Plik na telefonie (zapas): .\adb-pull-drive-logs.ps1"
