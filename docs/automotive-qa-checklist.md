# Android Auto + CarPlay QA Checklist

## Functional E2E (Phone + Head Unit)
- Start navigation from phone, verify route appears on Android Auto screen.
- Maneuver updates change while driving/simulating movement.
- `Stop` action from Android Auto requests stop in phone app.
- Kill/reopen app during active navigation, verify session snapshot can be recovered.
- Verify destination, ETA, and remaining distance values update over time.

## GPS / Connectivity Resilience
- Drive with temporary GPS loss and verify reroute and step recovery.
- Toggle network offline/online and ensure navigation snapshot POST resumes.
- Force JWT expiry scenario and verify proxy calls can recover via `/api/auth/refresh`.
- Verify location stream throttling in Socket.IO does not flood updates.

## Backend Validation
- Confirm `/api/navigation/session` stores and returns active snapshot.
- Confirm `/api/navigation/session/active` expires stale sessions.
- Confirm `/api/mapbox/directions` respects higher automotive rate limit path.
- Confirm regular mobile clients still use standard directions rate limits.

## Android Auto Release Readiness
- Verify `VroomCarAppService` is discoverable by DHU/Android Auto.
- Validate service metadata (`com.google.android.gms.car.application`, `minCarApiLevel`).
- Run Android Auto UX review checklist for template-safe interactions.
- Capture demo videos/logs for Google Play automotive review.

## CarPlay Readiness (requires macOS build pipeline)
- Run `expo prebuild --platform ios` on macOS and confirm plugin copies `native/ios-carplay/*`.
- Confirm `UISupportsCarPlay` and `com.apple.developer.carplay-navigation` entitlement are present.
- Verify CarPlay scene delegate is wired in iOS project scene manifest.
- Validate CP template behavior on CarPlay simulator and a real head unit if available.
- Submit/track Apple CarPlay Navigation entitlement request with app metadata and demo flow.
