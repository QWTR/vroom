# Driving and Navigation Regression Checklist

## Scope

Use this checklist after GPS/DR/snap/reroute changes in `Driving Mode` and `Navigation`.

## Pre-Flight

- Device has fresh OTA/build with the current branch.
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

## Log Signals to Check (ReactNativeJS)

- `[VROOM-GPS] DRIVE_HEALTH`
  - `speedHudKmh`
  - `speedPipeKmh`
  - `gpsAgeMs`
  - `drAgeMs`
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
- No repeated heading jitter left-right on straight roads.
- Off-route reroute converges without infinite pending/loop.
- Speed HUD remains available and plausible while moving.
- Distance increments match real movement without long stalls.
