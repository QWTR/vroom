import {
  bearingBetween,
  haversineM,
  moveAlongBearingM,
} from './geoMath';
import type { LatLng } from './types';

export type DeadReckoningInput = {
  from: LatLng;
  speedMs: number;
  headingDeg: number;
  dtMs: number;
  roadPts: LatLng[] | null;
  segmentIndex: number;
};

export type DeadReckoningOutput = {
  position: LatLng;
  segmentIndex: number;
  headingDeg: number;
};

/**
 * Predicts position between GPS fixes — along road geometry when available.
 */
export function predictDeadReckoning(input: DeadReckoningInput): DeadReckoningOutput {
  const { from, speedMs, headingDeg, dtMs, roadPts, segmentIndex } = input;
  const dtSec = Math.max(0, Math.min(2.5, dtMs / 1000));
  const stepM = Math.max(0, speedMs) * dtSec;
  if (stepM < 0.05) {
    return { position: from, segmentIndex, headingDeg };
  }

  if (roadPts && roadPts.length >= 2) {
    const advanced = advanceAlongPolyline(roadPts, segmentIndex, from, stepM);
    return {
      position: { latitude: advanced.lat, longitude: advanced.lng },
      segmentIndex: advanced.idx,
      headingDeg: advanced.headingDeg,
    };
  }

  const moved = moveAlongBearingM(from.latitude, from.longitude, headingDeg, stepM);
  return { position: moved, segmentIndex, headingDeg };
}

function advanceAlongPolyline(
  pts: LatLng[],
  startIdx: number,
  from: LatLng,
  distM: number,
): { lat: number; lng: number; idx: number; headingDeg: number } {
  let idx = Math.max(0, Math.min(pts.length - 2, startIdx));
  let curLat = from.latitude;
  let curLng = from.longitude;
  let remaining = distM;

  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversineM(curLat, curLng, pts[i].latitude, pts[i].longitude);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  if (Math.abs(bestI - idx) > 6) idx = Math.max(0, Math.min(pts.length - 2, bestI));

  for (let guard = 0; guard < 32 && remaining > 0.01; guard++) {
    const a = pts[idx];
    const b = pts[idx + 1];
    const segM = haversineM(a.latitude, a.longitude, b.latitude, b.longitude);
    if (segM < 0.05) {
      idx = Math.min(pts.length - 2, idx + 1);
      continue;
    }
    if (remaining < segM) {
      const t = remaining / segM;
      curLat = a.latitude + (b.latitude - a.latitude) * t;
      curLng = a.longitude + (b.longitude - a.longitude) * t;
      remaining = 0;
      const hdg = bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude);
      return { lat: curLat, lng: curLng, idx, headingDeg: hdg };
    }
    remaining -= segM;
    idx = Math.min(pts.length - 2, idx + 1);
    curLat = b.latitude;
    curLng = b.longitude;
  }

  const last = pts[Math.min(pts.length - 1, idx + 1)];
  const prev = pts[idx];
  const hdg = bearingBetween(prev.latitude, prev.longitude, last.latitude, last.longitude);
  return { lat: curLat, lng: curLng, idx, headingDeg: hdg };
}
