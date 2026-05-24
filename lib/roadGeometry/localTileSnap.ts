/**
 * v10 - localTileSnap.ts
 *
 * Ekstrakcja road geometry z aktualnie RENDEROWANYCH Mapbox vector tiles
 * przy uzyciu `queryRenderedFeaturesInRect`. Calkowicie LOKALNE — bez zadnego
 * API call. Wykorzystuje fakt ze Mapbox MapView ma juz w pamieci geometrie
 * widocznych ulic (z prefetched offline tiles albo cache HTTP).
 *
 * Uzycie w getLocalSnapTarget (L3):
 *   const polylines = await getLocalRoadGeometry(mapRef, lat, lng);
 *   // wybierz najblizszy polyline -> snapToRoute
 */
import type { RefObject } from 'react';
import type Mapbox from '@rnmapbox/maps';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

type LatLng = { latitude: number; longitude: number };

/** Polowa boku rect (px). 240x240px boks ~ +-50-150m zaleznie od zoomu. */
const TILE_SNAP_PIXEL_HALF = 120;

/** Prefiksy ID warstw road w Mapbox Standard/Streets v11. */
const ROAD_LAYER_PREFIXES: ReadonlyArray<string> = ['road', 'tunnel', 'bridge'];

/** Source-layer dla road w vector tiles Mapbox Streets v8. */
const ROAD_SOURCE_LAYERS: ReadonlySet<string> = new Set(['road', 'roads']);

/** Klasy road ktore akceptujemy (drogi przejezdne, bez pedestrian/path/cycleway). */
const ACCEPTED_ROAD_CLASSES: ReadonlySet<string> = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'street',
  'street_limited',
  'service',
  'residential',
  'unclassified',
  'living_street',
  'track',
]);

function isRoadFeature(feat: unknown): feat is Feature {
  if (!feat || typeof feat !== 'object') return false;
  const f = feat as Record<string, unknown>;
  const layer = f.layer as Record<string, unknown> | undefined;
  const layerId = typeof layer?.id === 'string' ? layer.id : '';
  const srcLayerCandidate =
    (f.sourceLayer as string | undefined)
    ?? (layer?.['source-layer'] as string | undefined);
  const srcLayer = typeof srcLayerCandidate === 'string' ? srcLayerCandidate.toLowerCase() : '';
  const props = (f.properties as Record<string, unknown> | null) ?? null;
  const klass = typeof props?.class === 'string' ? (props.class as string) : '';

  const layerLooksLikeRoad = ROAD_LAYER_PREFIXES.some(p => layerId.toLowerCase().startsWith(p));
  const sourceLooksLikeRoad = ROAD_SOURCE_LAYERS.has(srcLayer);
  if (!layerLooksLikeRoad && !sourceLooksLikeRoad) return false;

  // Jesli mamy klase, sprawdz czy to "real road" (nie pedestrian etc).
  if (klass) {
    return ACCEPTED_ROAD_CLASSES.has(klass);
  }
  return true;
}

function lineStringToPoints(coords: Position[]): LatLng[] {
  const out: LatLng[] = [];
  for (const c of coords) {
    if (
      Array.isArray(c)
      && c.length >= 2
      && Number.isFinite(c[0])
      && Number.isFinite(c[1])
    ) {
      out.push({ longitude: Number(c[0]), latitude: Number(c[1]) });
    }
  }
  return out;
}

/**
 * Zwraca tablice polyline (LatLng[][]) road segmentow widocznych wokol punktu GPS
 * na aktualnym viewport Mapbox. Brak match -> null.
 *
 * UWAGA: dziala tylko gdy tile pod (lat,lng) jest aktualnie renderowany przez
 * MapView. W driving mode kamera trzyma marker w centrum, wiec tile pod marker
 * jest zawsze renderowany.
 */
export async function getLocalRoadGeometry(
  mapRef: RefObject<Mapbox.MapView>,
  lat: number,
  lng: number,
): Promise<LatLng[][] | null> {
  const map = mapRef.current as unknown as {
    getPointInView?: (coord: [number, number]) => Promise<[number, number]>;
    queryRenderedFeaturesInRect?: (
      bbox: [number, number, number, number],
      filter?: unknown,
      layerIDs?: string[] | null,
    ) => Promise<FeatureCollection | undefined>;
  } | null;
  if (!map || typeof map.getPointInView !== 'function' || typeof map.queryRenderedFeaturesInRect !== 'function') {
    return null;
  }
  try {
    const screen = await map.getPointInView([lng, lat]);
    if (!Array.isArray(screen) || screen.length < 2) return null;
    const x = Number(screen[0]);
    const y = Number(screen[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const half = TILE_SNAP_PIXEL_HALF;
    // bbox: [top, left, bottom, right] / [minY, minX, maxY, maxX]
    const bbox: [number, number, number, number] = [
      y - half,
      x - half,
      y + half,
      x + half,
    ];
    const collection = await map.queryRenderedFeaturesInRect(bbox, undefined, null);
    if (!collection || !Array.isArray(collection.features)) return null;

    const polylines: LatLng[][] = [];
    for (const feat of collection.features) {
      if (!isRoadFeature(feat)) continue;
      const geom = feat.geometry as Geometry | null;
      if (!geom) continue;
      if (geom.type === 'LineString') {
        const pts = lineStringToPoints(geom.coordinates as Position[]);
        if (pts.length >= 2) polylines.push(pts);
      } else if (geom.type === 'MultiLineString') {
        for (const line of geom.coordinates as Position[][]) {
          const pts = lineStringToPoints(line);
          if (pts.length >= 2) polylines.push(pts);
        }
      }
    }
    return polylines.length > 0 ? polylines : null;
  } catch (e) {
    if (__DEV__) console.warn('[localTileSnap] failed', e);
    return null;
  }
}

/**
 * Convenience: wybiera polyline najblizszy do (lat,lng) z wyniku
 * getLocalRoadGeometry — zwraca pojedyncza polyline gotowa do przekazania
 * do snapToRoute.
 */
export function pickNearestPolyline(
  polylines: LatLng[][],
  lat: number,
  lng: number,
): LatLng[] | null {
  if (!Array.isArray(polylines) || polylines.length === 0) return null;
  let bestIdx = -1;
  let bestMinSq = Infinity;
  for (let i = 0; i < polylines.length; i++) {
    const pts = polylines[i];
    for (let j = 0; j < pts.length; j++) {
      const dLat = pts[j].latitude - lat;
      const dLng = pts[j].longitude - lng;
      const sq = dLat * dLat + dLng * dLng;
      if (sq < bestMinSq) {
        bestMinSq = sq;
        bestIdx = i;
      }
    }
  }
  return bestIdx >= 0 ? polylines[bestIdx] : null;
}
