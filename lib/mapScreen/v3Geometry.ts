import { makeRoadPolyline, type RoadPolyline } from '../navigationV3';

export type V3GeometryResult = {
  roadPolylines: RoadPolyline[];
  routePolyline: { lat: number; lng: number }[] | null;
  /** false = wolny GPS (off-route), ale polilinia trasy nadal dostępna do renderu. */
  shouldSnapToRoute: boolean;
};

export function buildV3GeometryFromRefs(input: {
  matchedGeometry: { latitude: number; longitude: number }[];
  routePoints: { latitude: number; longitude: number }[];
  isNavigating: boolean;
  /** Poza trasą — wyłącz snap do polilinii, ale zachowaj geometrię trasy. */
  suppressRouteSnap?: boolean;
  mirrorPolylines: { latitude: number; longitude: number }[][];
}): V3GeometryResult {
  const shouldSnapToRoute = !input.suppressRouteSnap;

  const roadPolylines: RoadPolyline[] = [];
  const seen = new Set<string>();

  const addPolyline = (key: string, pts: { latitude: number; longitude: number }[]) => {
    if (pts.length < 2) return;
    const sig = `${pts.length}:${pts[0].latitude.toFixed(5)},${pts[0].longitude.toFixed(5)}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const packed = makeRoadPolyline(
      key,
      pts.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    );
    if (packed) roadPolylines.push(packed);
  };

  // Prefer the local/visible road mirror first. It is closest to the rendered
  // OSM road and prevents stale map-match geometry from locking the marker onto
  // a parallel/offscreen road.
  for (let i = 0; i < input.mirrorPolylines.length; i += 1) {
    addPolyline(`mirror_${i}`, input.mirrorPolylines[i]!);
  }
  // During navigation this ref can still contain the old route geometry.
  // Never feed it back as a generic road candidate after an off-route turn.
  if (!input.isNavigating) addPolyline('road_match', input.matchedGeometry);

  const routePolyline = input.isNavigating && input.routePoints.length >= 2
    ? input.routePoints.map((p) => ({ lat: p.latitude, lng: p.longitude }))
    : null;

  return {
    roadPolylines,
    routePolyline,
    shouldSnapToRoute: input.isNavigating ? shouldSnapToRoute : true,
  };
}
