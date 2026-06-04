# Na żywo: snap / marker / GPS z telefonu (VROOM-TEL).
#   cd c:\VROOMAPP\vroom\scripts
#   .\adb-live-drive-debug.ps1
# Ctrl+C = koniec. Po jeździe: .\adb-dump-vroom-logs.ps1

$ErrorActionPreference = 'Stop'

function Resolve-Adb {
  $candidates = @(
    $env:ADB,
    'adb',
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    'D:\Android\Sdk\platform-tools\adb.exe',
    'C:\Android\platform-tools\adb.exe'
  ) | Where-Object { $_ -and ($_ -ne 'adb' -or (Get-Command adb -ErrorAction SilentlyContinue)) }

  foreach ($c in $candidates) {
    if ($c -eq 'adb') {
      $cmd = Get-Command adb -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
      continue
    }
    if (Test-Path $c) { return $c }
  }
  return $null
}

$adb = Resolve-Adb
if (-not $adb) {
  Write-Host 'Brak adb. Zainstaluj: winget install Google.PlatformTools'
  Write-Host 'Albo ustaw sciezke: $env:ADB = "C:\...\platform-tools\adb.exe"'
  exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $PSScriptRoot "drive-live-$stamp.log"
$filter = 'VROOM-TEL|SNAP_|DRIVE_TRACE|GPS_|ENTRY_SNAP|ROAD_MATCH|MAP_MATCH|SNAP_FAIL|WORKLET|road_frame|MARKER|DrivingMapMatch|GPSDBG'

Write-Host "ADB: $adb"
& $adb devices
Write-Host "Filtr: $filter"
Write-Host "Zapis: $out"
Write-Host 'Wlacz tryb jazdy na mapie. Ctrl+C = stop.'
Write-Host ''

& $adb logcat -c
& $adb logcat -v time ReactNativeJS:* *:S |
  Select-String -Pattern $filter |
  Tee-Object -FilePath $out
