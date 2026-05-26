# VROOM V10 — Brief dla Gemini: marker skacze, prędkość 00, snap off-road, freeze przy wolnej jeździe

**Data:** 2026-05-24  
**Kontekst:** React Native (Expo) + Mapbox `@rnmapbox/maps` + Reanimated worklet. Tryb jazdy: `V10_CLIENT_FIRST = true` w `vroom/app/(tabs)/map.tsx`.

---

## 1. Co użytkownik chce (akceptacja)

| Wymaganie | Opis |
|-----------|------|
| Marker | Ma **płynąć** po mapie jak auto na drodze — ciągły ruch 60 FPS, **zero widocznych teleportów** |
| Snap | Marker **na jezdni** (snap-to-road / map-match), nie obok drogi |
| Prędkość HUD | Prawdziwa przy jeździe **także 3–15 km/h** (nie wymuszać 00 gdy jedzie wolno) |
| Postój | 0 km/h tylko gdy auto **naprawdę stoi** |
| Wolna jazda | Marker **nie może zamarznąć** — najczęstszy bug usera |

---

## 2. Architektura pozycji markera (V10)

```
GPS fix (~1–2 s)
    → drivingSnap / getLocalSnapTarget (L1 route, L2 SQLite, L3 tiles, L4 API)
    → applyTripPosition(lat, lng, { speedMs, heading })   // TYLKO kotwica snap
        → feedSmoothPositionTarget({ durationMs: 280–600, speedMs })
            → useSmoothMapPosition (Reanimated worklet, useFrameCallback 60fps)
                → dead reckoning: project forward (speed × dt)
                → moveToward anchor (snap kotwica)
                → runOnJS(notifySmoothPositionDisplay) co 16 ms
                    → subscribeSmoothPositionDisplay w SmoothDrPositionMarker
                        → requestAnimationFrame: stepTowardPose (max 2.8–5.5 m/klatkę)
                            → setPose → Mapbox.MarkerView coordinate={[lng, lat]}
```

**Kamera** (osobny listener): `subscribeSmoothPositionDisplay` → `updateCameraFrame` throttle 40 ms.

**Pliki kluczowe:**
- `vroom/hooks/useSmoothMapPosition.ts` — worklet
- `vroom/lib/mapPosition/smoothPositionFeed.ts` — feed + notify
- `vroom/components/map/SmoothDrPositionMarker.tsx` — MarkerView + rAF interpolacja
- `vroom/app/(tabs)/map.tsx` — `applyTripPosition`, GPS pipeline, snap, `publishSpeed`

---

## 3. Architektura prędkości HUD

```
GPS raw speed (Doppler) + pozycja
    → sanitizeSpeedMs / sanitizeSpeedKmh (speedSanitizer.ts)
    → publishSpeed() w map.tsx
        → reliableSpeedKmh (filtry postój, spike, geometry clamp)
        → emitSpeedometerKmh → DeviceEventEmitter → SpeedometerHUD
```

**`drInputSpeedMs`** (prędkość karmiąca worklet markera) = osobna logika w GPS handlerze:
- `0` gdy `netMoveM < 12 && sustainedKmh < 4.5 && motionKmh < 5` („postój”)
- inaczej `sanitizedSpeedMs` lub `kmh/3.6`

---

## 4. Zgłoszone symptomy ↔ prawdopodobne przyczyny w kodzie

### 4.1 Marker skacze / teleportuje

| Przyczyna | Gdzie | Mechanizm |
|----------|--------|-----------|
| **Podwójna interpolacja** | worklet + rAF marker | Kotwica skacze 20 m co GPS; worklet + rAF doganiają z opóźnieniem → „drganie” lub skok gdy `moveToward` dojeżdża w 1 klatce (`dist < maxStep`) |
| **`durationMs: 0` / instant** | `feedSmoothPositionTarget`, bootstrap | `notifySmoothPositionDisplay` od razu — pełny skok targetu (`smoothPositionFeed.ts` L97–99, `useSmoothMapPosition` L148–154) |
| **Clamp snap 20 m/tick** | `map.tsx` ~5868 | Przy dużym `jumpM` anchor przesuwa się max 20 m co ~1.5 s — przy słabym worklet może wyglądać jak skok |
| **Replay `lastTarget`** | `registerSmoothPositionHandler` | Remount workletu odtwarza stary target |
| **Dwa źródła heading** | `SmoothDrPositionMarker` | `pose` z rAF (pozycja), `heading` z `useAnimatedStyle` na shared value workletu — rotacja i pozycja mogą się rozjechać |

### 4.2 Marker „wypada” ze snap (obok drogi)

| Przyczyna | Gdzie |
|----------|--------|
| `SNAP_FAIL_HELD_ANCHOR` | snap fail → trzyma starą kotwicę podczas raw GPS ucieka |
| `hardRoadSnap && !snapped.snapped` + blend do raw | V10 krok do raw max 12–45 m — może być poza polilinią |
| Stara geometria map-match | `drivingSnapGeometryRef` nie odświeżona (recovery co 15 s dopiero po streak) |
| Brak frame snap w V10 | `DR.onFrame` w V10 **nie** snapuje co klatkę (tylko sync refów) — korekta tylko co GPS tick |

### 4.3 Marker zamarza (szczególnie < 12 km/h) — **KRYTYCZNY BUG**

```typescript
// map.tsx ~5757-5780 — gdy snap fail w driving:
const maxStepM = kmh >= 25 ? ... : kmh >= 8 ? ... : 0;  // ← przy kmh < 8 maxStepM = 0
```

Efekt łańcuchowy:
1. Snap fail → `maxStepM = 0` → kotwica **zamrożona** na `hold`
2. `drInputSpeedMs = 0` bo `netMoveM < 12` (przy 10 km/h w 3 s net ≈ 8 m)
3. `applyTripPosition` → `speedMs: 0`
4. Worklet: `speedMs.value > 0.35` false → **brak dead reckoning**
5. rAF: target się nie zmienia → **marker stoi w miejscu** mimo że auto jedzie

Dodatkowo worklet:
```typescript
const moving = spd >= 0.35;  // ~1.3 km/h — poniżej używa lastNonZeroSpeedMs
```

### 4.4 HUD pokazuje 00 przy jeździe < 12 km/h

| Warstwa | Warunek zerowania |
|---------|-------------------|
| `sanitizeSpeedKmh` | `stationaryEvidence`: `netM < 12 && sustained < 4.5` → return 0 |
| `sanitizeSpeedKmh` | `netM < 22 && geoKmh < 5` → return 0 |
| `publishSpeed` | ten sam `netMoveM < 12` + `stationaryEvidence` → `reliableSpeedKmh = 0` |
| `drInputSpeedMs` | `netMoveM < 12` → 0 → marker też stoi |

**Problem logiczny:** próg **12 m netto w 3 s** ≈ odpowiada **~14 km/h średnio**. Przy **8–11 km/h** `netMoveM` często **< 12** → system myśli że stoisz → HUD 0 + marker freeze.

To nie jest próg „12 km/h” w kodzie HUD — user widzi korelację z wolną jazdą.

---

## 5. Co już próbowano (nie wystarczyło)

- Usunięto `notifySmoothPositionDisplay` z `applyTripPosition` (tylko feed worklet)
- Worklet: ciągły ruch + `moveToward` do kotwicy 280–600 ms
- Marker rAF: max 2.8 m/klatkę wizualnie
- `publishSpeed` z `reliableSpeedKmh`, blokada Doppler ghost na postoju
- V10.12: nie rzucać markera na raw GPS przy snap fail (hold + krok)

---

## 6. Propozycje naprawy (dla Gemini — priorytet)

### P0 — Wolna jazda / freeze

1. **Nigdy `maxStepM = 0`** przy snap fail jeśli `rawDriftM > 0.5` — minimum `1.5–3 m/tick` skalowane `kmh` (np. `Math.max(1.5, kmh * 0.2)`).
2. **Dynamiczny próg postoju:** `standstillNetM = kmh < 15 ? 5 : 12` (lub `max(5, kmh * 0.4)` w oknie 3 s).
3. **`drInputSpeedMs`:** przy `motionKmh >= 3 && netMoveM >= 4` użyć `motionKmh/3.6` nawet gdy sanitized = 0.
4. **Worklet:** próg ruchu `0.35` → `0.08` m/s; przy `speedMs===0` iścieć do kotwicy po heading z `distAnchorM`.

### P1 — Płynność markera (jeden strumień)

5. **Usunąć rAF drugą warstwę** LUB zsynchronizować: MarkerView czyta **tylko** `sharedPosition` (Reanimated) bez `setPose` co klatkę — jeśli Mapbox pozwala.
6. **Zakazać `durationMs: 0`** w produkcji (bootstrap też 300 ms + nie notify instant z feed).
7. **Heading z tego samego źródła co lat/lng** (pose z notify, nie osobno shared w `markerRotateStyle`).

### P2 — Snap na drodze

8. Przywrócić **lekki per-frame snap** w V10 (cap 2–4 m) gdy `drivingSnapGeometryRef.length > 1` — tylko w worklet, bez JS.
9. Przy `SNAP_FAIL` krok wzdłuż **ostatniego segmentu** polilinii, nie blend do raw GPS.
10. Przy `jumpM > 20` rozłożyć korektę na **czas** (`durationMs` ∝ `jumpM/speed`), nie jeden clamp 20 m.

### P3 — Prędkość HUD

11. Osobny tryb **slow crawl** (`motionKmh 3–15`): HUD = `max(motionKmh, derivedKmh)` gdy `netMoveM >= 4`.
12. Nie zerować `lastReliableSpeedMsRef` przy jednym ticku `netMoveM < 12` jeśli `motionKmh >= 4`.

---

## 7. Telemetria do weryfikacji

Logi JSONL (`vroomGpsLog`):
- `WORKLET_FEED` — czy `speedMs` = 0 przy jeździe
- `SNAP_FAIL_HELD_ANCHOR` — częstotliwość
- `V10_APPLY_TRIP` — czy ticki idą
- `MARKER_HEARTBEAT` + `stuck: true` — freeze markera
- `SPEED_PIPE` / `SPEED_EMIT_SPIKE_BLOCK` — HUD 0 vs raw

**Test manualny:**
1. Jazda 8–10 km/h 30 s — marker jedzie, HUD 8–12
2. Postój 30 s — HUD 0, marker nie drga
3. Zakręt 30 km/h — marker na drodze, bez skoku > 5 m

---

## 8. Stałe do znajomości

| Stała | Wartość | Plik |
|-------|---------|------|
| `V10_CLIENT_FIRST` | true | map.tsx |
| `DISPLAY_NOTIFY_MIN_MS` | 16 | smoothPositionFeed.ts |
| `netMoveM` postój | < 12 | map.tsx, speedSanitizer.ts |
| `maxJumpM` driving V10 | 20 | map.tsx |
| Worklet `moving` | speed ≥ 0.35 m/s | useSmoothMapPosition.ts |
| Snap fail `maxStepM` low | **0** (bug) | map.tsx ~5761 |

---

## 9. Wdrożone (2026-05-24, rekomendacje Gemini)

- `tripStandstillNetM()` — próg **4 m** przy &lt;15 km/h, **12 m** inaczej
- `computeSnapFailMaxStepM` / `resolveV10SnapFailPosition` — brak `maxStepM=0`, snap wzdłuż polilinii przez **5 s**
- `publishSpeed` + `drInputSpeedMs` — slow crawl `motionKmh≥3`, `netMoveM≥4`, `motionKmh<3` = postój
- `useSmoothMapPosition` — jeden worklet, cap **3.2 m/klatkę**, próg **0.08 m/s**
- `SmoothDrPositionMarker` — **bez rAF**; `useAnimatedReaction` na SharedValue
- `smoothPositionFeed` — `durationMs:0` → **120 ms** poza bootstrap

## 10. Pytanie do Gemini

> Mając powyższy pipeline, zaproponuj **minimalny diff** (konkretne funkcje i warunki), który:
> 1) eliminuje freeze markera przy 5–15 km/h,
> 2) utrzymuje 0 km/h na postoju,
> 3) ogranicza teleporty do < 3 m widocznych na ekranie,
> 4) trzyma marker na geometrii drogi.
>
> Preferuj **jeden strumień pozycji** (worklet XOR rAF, nie oba). Wskaż które progi `netMoveM` są błędne fizycznie.

---

## 10. Fragmenty kodu (stan na 2026-05-24)

### applyTripPosition (feed tylko kotwicy)
```typescript
feedSmoothPositionTarget({
  latitude: lat,
  longitude: lng,
  heading,
  durationMs: smoothDurationMs, // 280-600 lub 0 instant
  speedMs: reliableSpeedMs,
  source: isInstant ? 'v10_apply_trip_instant' : 'v10_live_cruise',
});
```

### Snap fail — freeze przy niskiej prędkości
```typescript
const maxStepM = kmh >= 25
  ? Math.min(45, Math.max(12, kmh * 0.28, rawDriftM * 0.4))
  : kmh >= 8
    ? Math.min(22, Math.max(6, kmh * 0.18, rawDriftM * 0.35))
    : 0; // BUG: powinno być > 0 przy rawDriftM > 0
```

### publishSpeed — postój
```typescript
const stationaryEvidence =
  netMoveM < 12
  && sustainedKmh < 4.5
  && motionKmh < 5;
```

### Worklet — ruch
```typescript
const spd = speedMs.value > 0.35 ? speedMs.value : lastNonZeroSpeedMs.value;
const moving = spd >= 0.35;
if (moving) { /* project forward */ }
/* then moveToward anchor */
```
