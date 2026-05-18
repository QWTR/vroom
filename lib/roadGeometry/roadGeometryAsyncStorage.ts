import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RoadPoint } from './RoadGeometryStore.types';

type StoredSegment = {
  id: string;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  points: RoadPoint[];
  updated_at: number;
};

const STORAGE_KEY = '@vroom/road_geometry_segments_v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SEGMENTS = 120;

let cache: StoredSegment[] | null = null;

function simplifyPolyline(points: RoadPoint[], maxPoints: number): RoadPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: RoadPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1]?.latitude !== last.latitude) out.push(last);
  return out;
}

function bboxFromPoints(points: RoadPoint[]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }
  return { minLat, maxLat, minLng, maxLng };
}

async function loadSegments(): Promise<StoredSegment[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as StoredSegment[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(segments: StoredSegment[]): Promise<void> {
  const now = Date.now();
  cache = segments
    .filter((s) => now - s.updated_at < TTL_MS)
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, MAX_SEGMENTS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache)).catch(() => {});
}

export async function asyncInsert(points: RoadPoint[]): Promise<void> {
  if (points.length < 2) return;
  const simplified = simplifyPolyline(points, 500);
  const box = bboxFromPoints(simplified);
  const segments = await loadSegments();
  segments.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    ...box,
    points: simplified,
    updated_at: Date.now(),
  });
  await persist(segments);
}

export async function asyncFindNearest(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<{ points: RoadPoint[]; ageMs: number } | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const now = Date.now();
  const deg = radiusM / 111_000;
  const segments = (await loadSegments()).filter(
    (s) =>
      now - s.updated_at < TTL_MS &&
      s.min_lat <= lat + deg && s.max_lat >= lat - deg &&
      s.min_lng <= lng + deg && s.max_lng >= lng - deg,
  );

  let best: { points: RoadPoint[]; distM: number; ageMs: number } | null = null;
  for (const seg of segments) {
    const pts = seg.points;
    if (pts.length < 2) continue;
    let minDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const midLat = (pts[i].latitude + pts[i + 1].latitude) / 2;
      const midLng = (pts[i].longitude + pts[i + 1].longitude) / 2;
      const dLat = (midLat - lat) * 111_000;
      const dLng = (midLng - lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
      minDist = Math.min(minDist, Math.sqrt(dLat * dLat + dLng * dLng));
    }
    if (minDist <= radiusM && (!best || minDist < best.distM)) {
      best = { points: pts, distM: minDist, ageMs: now - seg.updated_at };
    }
  }
  return best ? { points: best.points, ageMs: best.ageMs } : null;
}
