# Po jeździe BEZ kabla: podłącz telefon i uruchom ten skrypt.
# Pobiera vroom_nav_drive.log z telefonu (NIE logcat — bufor logcat się czyści).
#
#   cd d:\VROOM\vroom\scripts
#   .\adb-pull-nav-logs.ps1

$adb = "D:\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
  Write-Host "Brak: $adb"
  exit 1
}

$paths = @(
  "/sdcard/Download/vroom_nav_drive.log",
  "/sdcard/Android/media/com.lexuuw.vroom.app/vroom_nav_drive.log"
)

Write-Host "ADB: $adb"
& $adb devices
$serial = (& $adb get-serialno 2>$null).Trim()
if ($serial -eq "unknown" -or -not $serial) {
  Write-Host "Brak podlaczonego urzadzenia."
  exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = $PSScriptRoot
$pulled = $false

foreach ($remote in $paths) {
  $local = Join-Path $outDir ("nav-drive-{0}-{1}.log" -f $stamp, ($remote -replace '[^a-zA-Z0-9]+', '_').Trim('_'))
  Write-Host "Proba: $remote"
  & $adb pull $remote $local 2>&1 | Out-Host
  if ((Test-Path $local) -and ((Get-Item $local).Length -gt 80)) {
    $pulled = $true
    $lines = @(Get-Content $local -ErrorAction SilentlyContinue)
    Write-Host ""
    Write-Host "=== OK: $local ($($lines.Count) linii, $((Get-Item $local).Length) B) ==="
    Write-Host "--- ostatnie 40 linii ---"
    $lines | Select-Object -Last 40
    Write-Host "--- koniec podgladu ---"
    break
  }
  if (Test-Path $local) { Remove-Item $local -Force -ErrorAction SilentlyContinue }
}

if (-not $pulled) {
  Write-Host ""
  Write-Host "Brak pliku na telefonie. Sprawdz:"
  Write-Host "  1) Najnowszy eas update (mirror pliku)"
  Write-Host "  2) Jechales w TRYBIE JAZDY (wlaczony przed startem)"
  Write-Host "  3) Uprawnienia plikow / Download na Androidzie"
  Write-Host ""
  Write-Host "Lista Download:"
  & $adb shell "ls -la /sdcard/Download/vroom* 2>/dev/null; ls -la /sdcard/Android/media/com.lexuuw.vroom.app/ 2>/dev/null"
  exit 1
}
