/** Widoczny prostokąt mapy — do cullingu floty live users. */
export type ViewportBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
  valid: 0 | 1;
};

export const EMPTY_VIEWPORT: ViewportBounds = {
  north: 90,
  south: -90,
  east: 180,
  west: -180,
  valid: 0,
};

/** Przybliżony bbox z centrum kamery i zoom (bez async getVisibleBounds). */
export function boundsFromCenterZoom(
  centerLat: number,
  centerLng: number,
  zoom: number,
  padding = 1.2,
): ViewportBounds {
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(zoom)) {
    return EMPTY_VIEWPORT;
  }
  const z = Math.max(3, Math.min(20, zoom));
  const latDelta = (360 / Math.pow(2, z)) * 0.55 * padding;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const lngDelta = cosLat > 0.15 ? latDelta / cosLat : latDelta;

  return {
    north: Math.min(90, centerLat + latDelta),
    south: Math.max(-90, centerLat - latDelta),
    east: centerLng + lngDelta,
    west: centerLng - lngDelta,
    valid: 1,
  };
}

export function isInViewport(lat: number, lng: number, bounds: ViewportBounds): boolean {
  'worklet';
  if (bounds.valid !== 1) return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat > bounds.north || lat < bounds.south) return false;
  if (bounds.west <= bounds.east) {
    return lng >= bounds.west && lng <= bounds.east;
  }
  return lng >= bounds.west || lng <= bounds.east;
}
