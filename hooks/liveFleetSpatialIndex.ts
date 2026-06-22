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

const FULL_WORLD_VIEWPORT: ViewportBounds = {
  north: 90,
  south: -90,
  east: 180,
  west: -180,
  valid: 1,
};

function wrapLng(lng: number): number {
  if (!Number.isFinite(lng)) return lng;
  let out = ((lng + 180) % 360 + 360) % 360 - 180;
  // Keep the eastern edge inclusive for bounds that land exactly on 180.
  if (out === -180 && lng > 0) out = 180;
  return out;
}

export function normalizeViewportBounds(bounds: ViewportBounds): ViewportBounds {
  if (bounds.valid !== 1) return EMPTY_VIEWPORT;
  if (
    !Number.isFinite(bounds.north)
    || !Number.isFinite(bounds.south)
    || !Number.isFinite(bounds.east)
    || !Number.isFinite(bounds.west)
  ) {
    return EMPTY_VIEWPORT;
  }
  const rawLngWidth = Math.abs(bounds.east - bounds.west);
  if (rawLngWidth >= 359.5) {
    return {
      ...FULL_WORLD_VIEWPORT,
      north: Math.min(90, Math.max(bounds.north, bounds.south)),
      south: Math.max(-90, Math.min(bounds.north, bounds.south)),
    };
  }
  return {
    north: Math.min(90, Math.max(bounds.north, bounds.south)),
    south: Math.max(-90, Math.min(bounds.north, bounds.south)),
    east: wrapLng(bounds.east),
    west: wrapLng(bounds.west),
    valid: 1,
  };
}

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

  if (lngDelta >= 180) {
    return {
      ...FULL_WORLD_VIEWPORT,
      north: Math.min(90, centerLat + latDelta),
      south: Math.max(-90, centerLat - latDelta),
    };
  }

  return normalizeViewportBounds({
    north: Math.min(90, centerLat + latDelta),
    south: Math.max(-90, centerLat - latDelta),
    east: centerLng + lngDelta,
    west: centerLng - lngDelta,
    valid: 1,
  });
}

/** Bbox wokół punktu — np. cały zasięg live users przy starcie mapy. */
export function boundsFromAnchorRadiusKm(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
): ViewportBounds {
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radiusKm)) {
    return EMPTY_VIEWPORT;
  }
  const latDelta = radiusKm / 111;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const lngDelta = cosLat > 0.15 ? radiusKm / (111 * cosLat) : latDelta;
  return normalizeViewportBounds({
    north: Math.min(90, centerLat + latDelta),
    south: Math.max(-90, centerLat - latDelta),
    east: centerLng + lngDelta,
    west: centerLng - lngDelta,
    valid: 1,
  });
}

export function expandBoundsByMeters(bounds: ViewportBounds, marginM: number): ViewportBounds {
  if (bounds.valid !== 1) return EMPTY_VIEWPORT;
  if (!Number.isFinite(marginM) || marginM <= 0) return normalizeViewportBounds(bounds);

  const normalized = normalizeViewportBounds(bounds);
  if (normalized.valid !== 1) return EMPTY_VIEWPORT;

  const midLat = (normalized.north + normalized.south) / 2;
  const latDelta = marginM / 111_320;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const lngDelta = cosLat > 0.15 ? marginM / (111_320 * cosLat) : latDelta;

  const rawWidth = normalized.west <= normalized.east
    ? normalized.east - normalized.west
    : 360 - normalized.west + normalized.east;
  if (rawWidth + lngDelta * 2 >= 359.5) {
    return {
      ...FULL_WORLD_VIEWPORT,
      north: Math.min(90, normalized.north + latDelta),
      south: Math.max(-90, normalized.south - latDelta),
    };
  }

  return normalizeViewportBounds({
    north: Math.min(90, normalized.north + latDelta),
    south: Math.max(-90, normalized.south - latDelta),
    east: normalized.east + lngDelta,
    west: normalized.west - lngDelta,
    valid: 1,
  });
}

export function isInViewport(lat: number, lng: number, bounds: ViewportBounds): boolean {
  'worklet';
  if (bounds.valid !== 1) return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat > bounds.north || lat < bounds.south) return false;
  const normalizedLng = ((lng + 180) % 360 + 360) % 360 - 180;
  if (bounds.west <= bounds.east) {
    return normalizedLng >= bounds.west && normalizedLng <= bounds.east;
  }
  return normalizedLng >= bounds.west || normalizedLng <= bounds.east;
}
