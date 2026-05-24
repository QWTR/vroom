import { useEffect } from 'react';
import {
  runOnJS,
  useSharedValue,
  useFrameCallback,
} from 'react-native-reanimated';
import {
  clearSmoothPositionFeed,
  notifySmoothPositionDisplay,
  registerSmoothPositionHandler,
  type SmoothTarget,
} from '../lib/mapPosition/smoothPositionFeed';

function lerpHeading(from: number, to: number, t: number): number {
  'worklet';
  const diff = ((to - from + 540) % 360) - 180;
  return ((from + diff * t) + 360) % 360;
}

function clampWorklet(n: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, n));
}

function haversineMWorklet(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  'worklet';
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectMetersWorklet(
  lat: number,
  lng: number,
  headingDeg: number,
  distM: number,
): { lat: number; lng: number } {
  'worklet';
  if (!Number.isFinite(distM) || distM <= 0) {
    return { lat, lng };
  }
  const R = 6371000;
  const br = (headingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const d = distM / R;
  const nextLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(br),
  );
  const nextLng = lngRad + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(nextLat),
  );
  return {
    lat: (nextLat * 180) / Math.PI,
    lng: (nextLng * 180) / Math.PI,
  };
}

function moveTowardWorklet(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  maxStepM: number,
): { lat: number; lng: number } {
  'worklet';
  const distM = haversineMWorklet(fromLat, fromLng, toLat, toLng);
  if (!Number.isFinite(distM) || distM <= maxStepM || distM < 0.05) {
    return { lat: toLat, lng: toLng };
  }
  const t = maxStepM / distM;
  return {
    lat: fromLat + (toLat - fromLat) * t,
    lng: fromLng + (toLng - fromLng) * t,
  };
}

export type SmoothMapPositionValues = {
  lat: ReturnType<typeof useSharedValue<number>>;
  lng: ReturnType<typeof useSharedValue<number>>;
  heading: ReturnType<typeof useSharedValue<number>>;
};

/**
 * ANCHOR-FORWARD (v10.15): pozycja = ostatni snap/GPS + predykcja od czasu fixa.
 * Bez akumulacji "jazdy do przodu + slabe dociaganie" (marker zostawal w tyle,
 * kamera z lookahead wygladala jakby wyprzedzala).
 */
export function useSmoothMapPosition(enabled: boolean): SmoothMapPositionValues {
  const lat = useSharedValue(0);
  const lng = useSharedValue(0);
  const heading = useSharedValue(0);

  const anchorLat = useSharedValue(0);
  const anchorLng = useSharedValue(0);
  const anchorHdg = useSharedValue(0);
  const hasTarget = useSharedValue(0);
  const speedMs = useSharedValue(0);
  const lastNonZeroSpeedMs = useSharedValue(0);
  const lastFeedMs = useSharedValue(0);
  const lastDisplayPushMs = useSharedValue(0);

  useEffect(() => {
    if (!enabled) {
      registerSmoothPositionHandler(null);
      hasTarget.value = 0;
      speedMs.value = 0;
      lastNonZeroSpeedMs.value = 0;
      lastFeedMs.value = 0;
      clearSmoothPositionFeed();
      return;
    }

    const onFeed = (target: SmoothTarget) => {
      const now = Date.now();
      const instant = target.durationMs === 0;

      if (target.speedMs != null && Number.isFinite(target.speedMs) && target.speedMs > 0) {
        speedMs.value = target.speedMs;
        lastNonZeroSpeedMs.value = target.speedMs;
      }
      anchorLat.value = target.latitude;
      anchorLng.value = target.longitude;
      anchorHdg.value = target.heading;
      lastFeedMs.value = now;

      const curLat = lat.value;
      const curLng = lng.value;
      const hasPos =
        hasTarget.value === 1
        && Number.isFinite(curLat)
        && Number.isFinite(curLng)
        && !(Math.abs(curLat) < 1e-6 && Math.abs(curLng) < 1e-6);

      if (instant || !hasPos) {
        lat.value = target.latitude;
        lng.value = target.longitude;
        heading.value = target.heading;
        hasTarget.value = 1;
        notifySmoothPositionDisplay(target.latitude, target.longitude, target.heading);
        return;
      }

      // Nowy fix: tylko kotwica — ruch w frame callback (bez skoku co GPS).
      hasTarget.value = 1;
    };

    registerSmoothPositionHandler(onFeed);
    return () => registerSmoothPositionHandler(null);
  }, [enabled, anchorHdg, anchorLat, anchorLng, hasTarget, heading, lat, lastDisplayPushMs, lastFeedMs, lastNonZeroSpeedMs, lng, speedMs]);

  useFrameCallback(
    () => {
      'worklet';
      if (hasTarget.value === 0) return;

      const now = Date.now();
      const feedAgeSec = lastFeedMs.value > 0
        ? clampWorklet((now - lastFeedMs.value) / 1000, 0, 2.4)
        : 0;
      const spd = speedMs.value > 0.35
        ? speedMs.value
        : (feedAgeSec < 2.4 ? lastNonZeroSpeedMs.value : 0);
      const moving = spd >= 0.35;

      // Predykcja od kotwicy (ostatni snap/GPS) — marker jedzie miedzy fixami.
      const maxPredictM = moving
        ? Math.min(85, spd * feedAgeSec * 1.08)
        : 0;
      const predicted = maxPredictM > 0
        ? projectMetersWorklet(anchorLat.value, anchorLng.value, anchorHdg.value, maxPredictM)
        : { lat: anchorLat.value, lng: anchorLng.value };

      const distToPredictM = haversineMWorklet(
        lat.value,
        lng.value,
        predicted.lat,
        predicted.lng,
      );

      if (distToPredictM > 0.04) {
        const frameDt = 1 / 60;
        const maxStepM = moving
          ? Math.min(distToPredictM, Math.max(spd * frameDt * 1.15, distToPredictM * 0.35))
          : Math.min(distToPredictM, 8 * frameDt + 0.8);
        const next = moveTowardWorklet(
          lat.value,
          lng.value,
          predicted.lat,
          predicted.lng,
          Math.max(0.2, maxStepM),
        );
        lat.value = next.lat;
        lng.value = next.lng;
      }

      if (moving) {
        heading.value = lerpHeading(
          heading.value,
          anchorHdg.value,
          clampWorklet(feedAgeSec * 3.2, 0.06, 0.28),
        );
      } else {
        heading.value = lerpHeading(heading.value, anchorHdg.value, 0.2);
      }

      if (now - lastDisplayPushMs.value >= 16) {
        lastDisplayPushMs.value = now;
        runOnJS(notifySmoothPositionDisplay)(lat.value, lng.value, heading.value);
      }
    },
    enabled,
  );

  return { lat, lng, heading };
}
