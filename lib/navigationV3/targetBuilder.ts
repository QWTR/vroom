import type { NavigationTarget, SnapResult } from './types';

export function buildNavigationTarget(
  snap: SnapResult,
  speedMs: number,
  allowInstant: boolean,
): NavigationTarget {
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
  };
}
