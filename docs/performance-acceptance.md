# VROOM — performance and energy acceptance

This release is not eligible for publication until the device measurements below are completed on production builds. Development builds and simulators are not accepted as energy baselines.

## Controlled setup

- Run every scenario three times on the same device and compare medians.
- Start within a 5% battery-level range, with equal brightness, network type, location permissions and thermal state.
- Test one low-end and one mid-range Android device, plus one older and one current iPhone.
- Record the app version, commit, OS, device, ambient temperature and measurement tool output.
- Safety, trip continuity and navigation accuracy override every power target.

## Required scenarios

1. 15 minutes on Home and community screens.
2. 15 minutes switching features, including 20 tab cycles and 10 full-screen modals.
3. 15 minutes of the multimedia feed.
4. 30 minutes of simulated or real navigation with the map visible.
5. 15 minutes of an active trip with the map tab left.
6. Background, screen lock, network loss, GPS recovery and return to the trip.
7. Android Auto and CarPlay while moving, moving slowly and stationary.

## Release gates

- Median energy use is at least 30% lower than the pre-change production baseline in normal-use and driving scenarios.
- A warm scene restores usable cached UI within 500 ms.
- No hidden scene retains GPS, polling, sockets, media playback, animations or GPU surfaces unless an active trip explicitly requires it.
- Navigation, distance, warnings, voice guidance, Android Auto and CarPlay retain continuity and accuracy.
- Memory after 20 tab cycles is no more than 10% above the settled starting value.
- Draft messages and forms survive scene suspension.
- Vitest, Android native tests, lint, Expo Doctor, Android/iOS release builds, cold start, OTA and full trip regression pass.

## Tools

- React Native DevTools: JS work, renders and memory.
- Android Studio Profiler, Perfetto and Batterystats: CPU/GPU, wakeups, network and energy.
- Instruments Energy Log and Core Animation: iOS energy and frame pacing.
- Expo Atlas: bundle ownership, duplicate modules and dead assets.

Store raw captures outside the repository and add only a small comparison table here. Never record user location, routes, content identifiers or user-entered text in performance telemetry.
