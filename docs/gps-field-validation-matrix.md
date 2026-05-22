# GPS Field Validation Matrix (iOS + Android)

## Scope

Use this matrix for every release that changes GPS, driving mode, navigation, snap-to-road, speed HUD, or camera follow.

## Required Logs and Telemetry

- Device logs: `VROOM-GPS`, `RUNDIAG`, `GPSDBG`.
- Backend telemetry session: `/api/live/map-telemetry`.
- Admin panel validation: `Map Telemetry` KPI strip.

## Scenario Matrix

| Scenario | Duration | Pass Criteria |
|---|---:|---|
| Stationary (engine on/off) | 3-5 min | No jumps >10 m, speed HUD stays near 0 |
| Slow urban (5-20 km/h) | 5 min | No wrong-road snap, no freeze, camera follows smoothly |
| Medium city (40-60 km/h) | 8 min | HUD speed tracks movement with stable values |
| Fast road (80-120 km/h) | 8 min | Marker and camera remain live, no delayed batches |
| Off-route + reroute | 1 cycle | Reattach within one reroute cycle, no infinite reroute |
| Background resume | 2 cycles | Return without teleport, follow resumes quickly |
| Cold start drive entry | 1 cycle | Map loads usable tiles quickly, marker starts correctly |

## KPI Release Gates

Evaluate from `drive_health` events in telemetry:

- `gpsAgeMs p95 <= 1200`
- `drAgeMs p95 <= 120`
- `snapAnchorDriftM p95 <= 20`
- `gpsToDriftM p95 <= 25`
- `abs(speedHudKmh - speedPipeKmh) p95 <= 10`
- `driving_marker_stall` critical events: `0`

If any gate fails on either platform, release is blocked.

## Evidence Checklist

- Route ID / city and timestamp.
- iOS and Android build versions.
- Session IDs for both runs.
- Notes for each failed gate with short root-cause hypothesis.
