// Każdy POI pozostaje oddzielnym markerem: pin na średnim zoomie,
// informacyjna karta dopiero z bliska. Widok kraju pozostaje czysty.
export const MAP_POI_MIN_ZOOM = 11.5;
export const MAP_POI_CARD_MIN_ZOOM = 14.5;
export const MAP_POI_LABEL_MIN_ZOOM = MAP_POI_CARD_MIN_ZOOM;
export const MAP_LIVE_MIN_ZOOM = 11.5;
export const MAP_LIVE_LABEL_MIN_ZOOM = 15.5;

export type MapViewportBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type MapViewport = {
  bounds: MapViewportBounds;
  center: { latitude: number; longitude: number };
  zoom: number;
  revision: number;
};

export function normalizeLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function createMapViewport(
  visibleBounds: readonly [readonly [number, number], readonly [number, number]],
  zoom: number,
  revision: number,
): MapViewport | null {
  const [topRight, bottomLeft] = visibleBounds;
  const east = Number(topRight?.[0]);
  const north = Number(topRight?.[1]);
  const west = Number(bottomLeft?.[0]);
  const south = Number(bottomLeft?.[1]);
  if (![east, north, west, south, zoom].every(Number.isFinite)) return null;
  const span = east >= west ? east - west : 360 - west + east;
  return {
    bounds: { north, south, east, west },
    center: {
      latitude: (north + south) / 2,
      longitude: normalizeLongitude(west + span / 2),
    },
    zoom,
    revision,
  };
}

/** Adds proportional overscan and splits a box crossing the antimeridian. */
export function viewportQueryBoxes(viewport: MapViewport, marginRatio = 0.2): MapViewportBounds[] {
  const { north, south, east, west } = viewport.bounds;
  const latPad = Math.abs(north - south) * marginRatio;
  const rawSpan = east >= west ? east - west : 360 - west + east;
  const lngPad = rawSpan * marginRatio;
  const expandedSouth = Math.max(-90, south - latPad);
  const expandedNorth = Math.min(90, north + latPad);
  const start = west - lngPad;
  const end = west + rawSpan + lngPad;
  if (end - start >= 360) {
    return [{ north: expandedNorth, south: expandedSouth, west: -180, east: 180 }];
  }
  const normalizedStart = normalizeLongitude(start);
  const normalizedEnd = normalizeLongitude(end);
  if (normalizedStart <= normalizedEnd && Math.floor((start + 180) / 360) === Math.floor((end + 180) / 360)) {
    return [{ north: expandedNorth, south: expandedSouth, west: normalizedStart, east: normalizedEnd }];
  }
  return [
    { north: expandedNorth, south: expandedSouth, west: normalizedStart, east: 180 },
    { north: expandedNorth, south: expandedSouth, west: -180, east: normalizedEnd },
  ];
}

export function viewportCacheKey(viewport: MapViewport): string {
  const boxes = viewportQueryBoxes(viewport);
  const step = viewport.zoom >= 15 ? 0.005 : viewport.zoom >= 13 ? 0.02 : 0.05;
  const quantize = (value: number) => Math.round(value / step) * step;
  return `${Math.floor(viewport.zoom * 2) / 2}:${boxes.map((box) =>
    [box.south, box.west, box.north, box.east].map((n) => quantize(n).toFixed(3)).join(','),
  ).join(';')}`;
}

export function isCoordinateInViewport(
  latitude: number,
  longitude: number,
  viewport: MapViewport | null,
): boolean {
  if (!viewport || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const { north, south, east, west } = viewport.bounds;
  const inLng = east >= west
    ? longitude >= west && longitude <= east
    : longitude >= west || longitude <= east;
  return latitude >= south && latitude <= north && inLng;
}
