# Pobiera vroom_drive_session.log z telefonu — NIE zalezy od bufora logcat.
#
#   cd D:\VROOM\vroom\scripts
#   .\adb-pull-drive-logs.ps1

$adb = "adb"
if (Test-Path "D:\Android\Sdk\platform-tools\adb.exe") {
  $adb = "D:\Android\Sdk\platform-tools\adb.exe"
}

$paths = @(
  "/sdcard/Download/vroom_drive_session.log",
  "/sdcard/Android/media/com.lexuuw.vroom.app/vroom_drive_session.log",
  "/sdcard/Download/vroom_nav_drive.log",
  "/sdcard/Download/vroom_telemetry.log"
)

Write-Host "ADB: $adb"
& $adb devices

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$pulled = $false

foreach ($remote in $paths) {
  $base = Split-Path $remote -Leaf
  $local = Join-Path $PSScriptRoot ("pull-{0}-{1}" -f $stamp, $base)
  Write-Host "Proba: $remote"
  & $adb pull $remote $local 2>&1 | Out-Host
  if ((Test-Path $local) -and ((Get-Item $local).Length -gt 40)) {
    $pulled = $true
    $lines = @(Get-Content $local -ErrorAction SilentlyContinue)
    Write-Host ""
    Write-Host "=== OK: $local ($($lines.Count) linii, $((Get-Item $local).Length) B) ==="
    Write-Host "--- ostatnie 30 linii ---"
    $lines | Select-Object -Last 30
    break
  }
  if (Test-Path $local) { Remove-Item $local -Force -ErrorAction SilentlyContinue }
}

if (-not $pulled) {
  Write-Host ""
  Write-Host "Brak pliku. Sprawdz:"
  Write-Host "  1) Nowy build z DRIVE_SESSION_TRACE"
  Write-Host "  2) Otworz aplikacje (powinien byc DRIVE_TRACE_PING w logcat)"
  Write-Host "  3) Jedz w trybie jazdy"
  Write-Host ""
  Write-Host "Lista Download:"
  & $adb shell "ls -la /sdcard/Download/vroom* 2>/dev/null"
  exit 1
}
