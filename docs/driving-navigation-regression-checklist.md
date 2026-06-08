# Driving and Navigation Regression Checklist

## Scope

Use this checklist after GPS/DR/snap/reroute changes in `Driving Mode` and `Navigation`.

## Pre-Flight

- Device has fresh OTA/build with the current branch.
- Run every test on both Android and iOS (same route where possible).
- Location permission is set to precise/high accuracy.
- Map tiles are preloaded for the test area.
- Test route includes:
  - long straight segment,
  - several turns,
  - one intentional off-route detour,
  - a low-speed section (5-15 km/h),
  - a medium-speed section (40-60 km/h).

## Test Run 1: Driving Smoothness

- Start `Driving Mode` and drive 3-5 minutes in city traffic.
- Verify marker does not teleport by visible jumps.
- Verify marker follows movement live (no visible 1-2s trailing behind road position).
- Verify camera heading remains stable on straight segments.
- Verify no left-right oscillation when speed is steady.
- Verify speed HUD updates continuously (no random drop to blank/zero while moving).

## Test Run 2: Navigation Off-Route and Reroute

- Start navigation and leave the route intentionally.
- Verify off-route banner appears once and remains readable.
- Verify reroute request does not loop endlessly.
- Verify snap remains attached to last valid geometry during reroute transition.
- Verify route reattaches and camera stabilizes within one reroute cycle.

## Test Run 3: Distance Consistency

- During navigation, compare driven distance vs HUD/summary growth.
- During driving mode, verify distance keeps increasing even if GPS `speed=0` glitches.
- Verify no long periods of frozen distance while marker visibly moves.
- Verify summary distance remains close to reference trip distance (target drift <= 5% on 10-20 km run).

## Test Run 6: Intersections and Low-Speed Heading (V2 snap stability)

- Approach a 4-way intersection at 30-40 km/h and drive straight through without turning.
- Verify marker does not jump onto the cross street (no lateral snap to perpendicular road).
- Repeat with a deliberate 90° turn; verify marker follows the turn within ~1 s (no instant teleport).
- Stop at traffic lights for 20-30 s with engine running.
- Verify marker heading stays stable (no compass spin while stationary).
- After green, verify marker resumes forward motion without backward “jojo” correction.

## Test Run 4: Marker Rotation SSOT (Driving / Nav)

- Drive 50-120 km/h on straight highway for 2+ minutes.
- Verify marker does not spin or flip 90/180 deg while road is straight.
- Enter a roundabout at ~40-60 km/h; verify rotation follows curve without jitter.
- Verify marker stays in camera viewport (no drift to edge then snap back).
- At crawl speed below 10 km/h, verify marker heading stays locked (no compass-driven spins).

## Test Run 5: Stop-Go Speed Stability

- Run 2-3 minutes in stop-go traffic or repeated starts from standstill.
- Verify speed wakes quickly after launch (no long zero hold while car already moves).
- Verify speed drops to 0 smoothly when stopped (no oscillating 0/20 spikes).
- Verify no stale high speed hold when vehicle is stationary.

## Log Signals to Check (ReactNativeJS)

- `[VROOM-GPS] DRIVE_HEALTH`
  - `speedHudKmh`
  - `speedPipeKmh`
  - `gpsAgeMs`
  - `drAgeMs`
  - `gpsToDriftM`
  - `snapAnchorDriftM`
  - `offRoute`
  - `reroutePending`
  - `rerouteLoading`
  - `hasRoutePts`
- Existing diagnostics:
  - `SNAP_TICK`
  - `DRIVING_JUMP_REJECT`
  - `STATIONARY_HOLD`
  - `driving_marker_stall`
  - `gps_active_recovery`

## Pass Criteria

- No recurring marker jumps larger than ~10 m in normal city driving.
- Marker lag is not visually noticeable; `gpsAgeMs` and `drAgeMs` stay stable, and drift metrics do not trend upward.
- No repeated heading jitter left-right on straight roads.
- Off-route reroute converges without infinite pending/loop.
- Speed HUD remains available and plausible while moving.
- Distance increments match real movement without long stalls.
