# Drive Core V2

Jeden pipeline trybu jazdy / nawigacji:

`raw GPS → motionState → speedMeter → roadSnap (lokalnie) → marker (Reanimated)`

## API Mapbox

- **Nawigacja:** zero requestów Map Matching — snap na `routePoints`.
- **Free-drive:** lokalny snap na `geometryCache` dopóki cross-track ≤ 18 m.
- **Sieć:** max ~1 batch / 4 s, tylko gdy `isMoving` + off-buffer lub koniec segmentu.

## Pliki

- `driveEngine.ts` — orkiestracja ticka
- `apiBudgetManager.ts` — throttle + bufor GPS
- `geometryCache.ts` — polilinia segmentu
- `mapMatchClient.ts` — jedyny HTTP (`flushMapMatchBatch`)

Włącz w `map.tsx`: `DRIVE_CORE_V2 = true`.
