import type { NavigationTarget, SnapResult } from './types';

export function buildNavigationTarget(
  snap: SnapResult,
  speedMs: number,
  allowInstant: boolean,
  gpsIntervalMs?: number,
): NavigationTarget {
  const intervalMs = Number.isFinite(gpsIntervalMs) && gpsIntervalMs! > 0
    ? gpsIntervalMs!
    : undefined;
  return {
    lat: snap.lat,
    lng: snap.lng,
    headingDeg: snap.headingDeg,
    speedMs: Math.max(0, speedMs),
    pathMode: snap.pathMode,
    roadBlend: snap.roadBlend,
    rawLat: snap.rawLat,
    rawLng: snap.rawLng,
    targetArcM: snap.arcM,
    arcWindow: snap.arcWindow,
    polylineKey: snap.polylineKey,
    allowInstant,
    gpsIntervalMs: intervalMs,
  };
}
