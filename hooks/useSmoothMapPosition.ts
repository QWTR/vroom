import { useEffect } from 'react';
import {
  useSharedValue,
  useFrameCallback,
} from 'react-native-reanimated';
import {
  registerSmoothPositionHandler,
  type SmoothTarget,
} from '../lib/mapPosition/smoothPositionFeed';

function lerpHeading(from: number, to: number, t: number): number {
  'worklet';
  const diff = ((to - from + 540) % 360) - 180;
  return ((from + diff * t) + 360) % 360;
}

export type SmoothMapPositionValues = {
  lat: ReturnType<typeof useSharedValue<number>>;
  lng: ReturnType<typeof useSharedValue<number>>;
  heading: ReturnType<typeof useSharedValue<number>>;
};

export function useSmoothMapPosition(enabled: boolean): SmoothMapPositionValues {
  const lat = useSharedValue(0);
  const lng = useSharedValue(0);
  const heading = useSharedValue(0);

  const fromLat = useSharedValue(0);
  const fromLng = useSharedValue(0);
  const fromHdg = useSharedValue(0);
  const toLat = useSharedValue(0);
  const toLng = useSharedValue(0);
  const toHdg = useSharedValue(0);
  const segStart = useSharedValue(0);
  const segDur = useSharedValue(1000);
  const hasTarget = useSharedValue(0);

  useEffect(() => {
    if (!enabled) {
      registerSmoothPositionHandler(null);
      return;
    }

    const onFeed = (target: SmoothTarget) => {
      const now = Date.now();
      const instant = target.durationMs === 0;
      const duration = instant
        ? 0
        : Math.max(90, Math.min(1400, target.durationMs ?? 1000));

      const curLat = lat.value;
      const curLng = lng.value;
      const curHdg = heading.value;
      const hasPos =
        hasTarget.value === 1
        && Number.isFinite(curLat)
        && Number.isFinite(curLng)
        && !(Math.abs(curLat) < 1e-6 && Math.abs(curLng) < 1e-6);

      if (instant || !hasPos) {
        fromLat.value = target.latitude;
        fromLng.value = target.longitude;
        fromHdg.value = target.heading;
        toLat.value = target.latitude;
        toLng.value = target.longitude;
        toHdg.value = target.heading;
        lat.value = target.latitude;
        lng.value = target.longitude;
        heading.value = target.heading;
        segStart.value = now;
        segDur.value = 0;
        hasTarget.value = 1;
        return;
      }

      fromLat.value = curLat;
      fromLng.value = curLng;
      fromHdg.value = curHdg;
      toLat.value = target.latitude;
      toLng.value = target.longitude;
      toHdg.value = target.heading;
      segStart.value = now;
      segDur.value = duration;
      hasTarget.value = 1;
    };

    registerSmoothPositionHandler(onFeed);
    return () => registerSmoothPositionHandler(null);
  }, [enabled, fromHdg, fromLat, fromLng, hasTarget, heading, lat, lng, segDur, segStart, toHdg, toLat, toLng]);

  useFrameCallback(
    () => {
      'worklet';
      if (hasTarget.value === 0) return;

      const now = Date.now();
      const t = Math.min(1, (now - segStart.value) / Math.max(segDur.value, 1));

      lat.value = fromLat.value + (toLat.value - fromLat.value) * t;
      lng.value = fromLng.value + (toLng.value - fromLng.value) * t;
      heading.value = lerpHeading(fromHdg.value, toHdg.value, t);

      if (t >= 0.999) {
        lat.value = toLat.value;
        lng.value = toLng.value;
        heading.value = toHdg.value;
      }
    },
    enabled,
  );

  return { lat, lng, heading };
}
