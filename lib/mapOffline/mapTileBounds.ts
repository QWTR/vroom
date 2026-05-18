export type LatLng = { latitude: number; longitude: number };

/** Mapbox offline pack bounds: [[neLng, neLat], [swLng, swLat]] */
export function boundsFromPoints(
  points: LatLng[],
  paddingDeg = 0.04,
): [[number, number], [number, number]] | null {
  if (!points.length) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }

  if (!Number.isFinite(minLat)) return null;

  return [
    [maxLng + paddingDeg, maxLat + paddingDeg],
    [minLng - paddingDeg, minLat - paddingDeg],
  ];
}

export function boundsAroundCenter(
  lat: number,
  lng: number,
  radiusDeg = 0.06,
): [[number, number], [number, number]] {
  return [
    [lng + radiusDeg, lat + radiusDeg],
    [lng - radiusDeg, lat - radiusDeg],
  ];
}
