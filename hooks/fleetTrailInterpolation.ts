import {
  FLEET_EXTRAPOLATE_MAX_MS,
  FLEET_MIN_SEGMENT_MS,
  FLEET_PUSH_DEFAULT_MS,
  FLEET_PUSH_MAX_MS,
  FLEET_PUSH_MIN_MS,
  FLEET_SLOT_MAX_POINTS,
} from './liveFleetMotion';

export type FleetTrailPoint = {
  lat: number;
  lng: number;
  t: number;
};

export type FleetLatLng = { lat: number; lng: number };

const MAX_IMPLAUSIBLE_SPEED_MPS = 55;
const TRAIL_FLAT_CHORD_THRESHOLD_M = 15;

export function parseIncomingTrail(raw: unknown): FleetTrailPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: FleetTrailPoint[] = [];
  for (const pt of raw.slice(-FLEET_SLOT_MAX_POINTS)) {
    const lat = Number((pt as FleetTrailPoint)?.lat);
    const lng = Number((pt as FleetTrailPoint)?.lng);
    const t = Number((pt as FleetTrailPoint)?.t);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng, t: Number.isFinite(t) ? t : Date.now() });
  }
  return out;
}

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  'worklet';
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  const a = s1 + s2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function clamp01(t: number): number {
  'worklet';
  return Math.max(0, Math.min(1, t));
}

export function lerp(a: number, b: number, t: number): number {
  'worklet';
  return a + (b - a) * t;
}

export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  'worklet';
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Odległość punktu od odcinka AB (przybliżenie w metrach). */
function pointToSegmentDistM(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const ab = haversineM(aLat, aLng, bLat, bLng);
  if (ab < 0.5) return haversineM(pLat, pLng, aLat, aLng);
  const ap = haversineM(aLat, aLng, pLat, pLng);
  const bp = haversineM(bLat, bLng, pLat, pLng);
  const s = (ab + ap + bp) / 2;
  const area2 = Math.max(0, s * (s - ab) * (s - ap) * (s - bp));
  const height = (2 * Math.sqrt(area2)) / (ab || 1);
  if (ap * ap > bp * bp + ab * ab) return bp;
  if (bp * bp > ap * ap + ab * ab) return ap;
  return height;
}

/** Trail wygląda jak linia prosta (brak geometrii drogi) — warto snap OSRM. */
export function isTrailChordFlat(trail: FleetTrailPoint[] | undefined): boolean {
  if (!trail || trail.length < 2) return true;
  if (trail.length === 2) return true;
  const first = trail[0];
  const last = trail[trail.length - 1];
  for (let i = 1; i < trail.length - 1; i++) {
    const d = pointToSegmentDistM(
      trail[i].lat, trail[i].lng,
      first.lat, first.lng,
      last.lat, last.lng,
    );
    if (d > TRAIL_FLAT_CHORD_THRESHOLD_M) return false;
  }
  return true;
}

export function isImplausibleJump(
  prevLat: number,
  prevLng: number,
  prevAt: number,
  nextLat: number,
  nextLng: number,
  nextAt: number,
): boolean {
  const dtSec = (nextAt - prevAt) / 1000;
  if (!Number.isFinite(dtSec) || dtSec <= 0.05) return false;
  const distM = haversineM(prevLat, prevLng, nextLat, nextLng);
  return distM / dtSec > MAX_IMPLAUSIBLE_SPEED_MPS;
}

function walkPolylineAtDistance(
  points: FleetLatLng[],
  targetM: number,
): { lat: number; lng: number; heading: number } {
  'worklet';
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    if (walked + seg >= targetM) {
      const segT = seg > 0 ? (targetM - walked) / seg : 0;
      const lat = lerp(points[i - 1].lat, points[i].lat, segT);
      const lng = lerp(points[i - 1].lng, points[i].lng, segT);
      return {
        lat,
        lng,
        heading: bearingDeg(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng),
      };
    }
    walked += seg;
  }
  const tail = points[points.length - 1];
  const prev = points[points.length - 2];
  return {
    lat: tail.lat,
    lng: tail.lng,
    heading: bearingDeg(prev.lat, prev.lng, tail.lat, tail.lng),
  };
}

function totalPolylineLengthM(points: FleetLatLng[]): number {
  'worklet';
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return acc;
}

/** Pozycja wzdłuż trailu według czasu (entity interpolation). */
export function interpolateAlongTrail(
  trail: FleetTrailPoint[],
  nowMs: number,
): { lat: number; lng: number; heading: number } | null {
  if (!trail.length) return null;
  if (trail.length === 1) {
    return { lat: trail[0].lat, lng: trail[0].lng, heading: 0 };
  }

  const firstT = trail[0].t;
  const lastT = trail[trail.length - 1].t;
  if (!Number.isFinite(firstT) || !Number.isFinite(lastT) || lastT <= firstT) {
    const tail = trail[trail.length - 1];
    return { lat: tail.lat, lng: tail.lng, heading: 0 };
  }

  const tNorm = clamp01((nowMs - firstT) / (lastT - firstT));
  const pts: FleetLatLng[] = trail.map((p) => ({ lat: p.lat, lng: p.lng }));
  const total = totalPolylineLengthM(pts);
  if (total <= 0.5) {
    const tail = trail[trail.length - 1];
    return { lat: tail.lat, lng: tail.lng, heading: 0 };
  }
  return walkPolylineAtDistance(pts, tNorm * total);
}

/** Pozycja wzdłuż polyline OSRM według czasu od ostatniego fixu. */
export function interpolateAlongPolyline(
  polyline: FleetLatLng[],
  progress01: number,
): { lat: number; lng: number; heading: number } | null {
  if (!polyline.length) return null;
  if (polyline.length === 1) {
    return { lat: polyline[0].lat, lng: polyline[0].lng, heading: 0 };
  }

  const tNorm = clamp01(progress01);
  const total = totalPolylineLengthM(polyline);
  if (total <= 0.5) {
    const tail = polyline[polyline.length - 1];
    return { lat: tail.lat, lng: tail.lng, heading: 0 };
  }
  return walkPolylineAtDistance(polyline, tNorm * total);
}

/** Interpolacja liniowa między dwoma fixami serwera (bez ekstrapolacji). */
export function interpolateEntity(
  prevLat: number,
  prevLng: number,
  prevAt: number,
  nextLat: number,
  nextLng: number,
  nextAt: number,
  nowMs: number,
): { lat: number; lng: number; heading: number } {
  const dt = nextAt - prevAt;
  const t = dt > 50 ? clamp01((nowMs - prevAt) / dt) : 1;
  const lat = lerp(prevLat, nextLat, t);
  const lng = lerp(prevLng, nextLng, t);
  return {
    lat,
    lng,
    heading: bearingDeg(prevLat, prevLng, nextLat, nextLng),
  };
}

/** Płynna animacja: znajomi bez limitu, reszta tylko w promieniu fullRadiusKm. */
export function resolveFleetAnimationTier(
  isFriend: boolean,
  distKm: number,
  fullRadiusKm: number,
): 'full' | 'static' {
  if (isFriend) return 'full';
  if (!Number.isFinite(distKm) || distKm <= fullRadiusKm) return 'full';
  return 'static';
}

/** Histereza: wejście ≤ enterKm, wyjście dopiero > exitKm (anty-miganie na granicy). */
export function resolveFleetAnimationTierWithHysteresis(
  isFriend: boolean,
  distKm: number,
  wasFull: boolean,
  enterKm: number,
  exitKm: number,
): 'full' | 'static' {
  if (isFriend) return 'full';
  if (!Number.isFinite(distKm)) return wasFull ? 'full' : 'static';
  if (wasFull) {
    return distKm <= exitKm ? 'full' : 'static';
  }
  return distKm <= enterKm ? 'full' : 'static';
}

/** Czas segmentu pushTarget: haversine(origin,target)/speed z clampem min/max. */
export function computeFleetPushDurationMs(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  speedMps: number,
  serverIntervalMs?: number | null,
): number {
  const distM = haversineM(fromLat, fromLng, toLat, toLng);
  if (distM < 0.5) return 0;
  let durMs = FLEET_PUSH_DEFAULT_MS;
  if (Number.isFinite(speedMps) && speedMps > 0.5) {
    durMs = Math.round((distM / speedMps) * 1000);
  } else if (Number.isFinite(serverIntervalMs) && (serverIntervalMs as number) > 50) {
    durMs = Math.round(serverIntervalMs as number);
  }
  return Math.max(FLEET_PUSH_MIN_MS, Math.min(FLEET_PUSH_MAX_MS, durMs));
}

/** Równomierne próbkowanie polyline OSRM do maxPoints punktów. */
export function samplePolylineForSlot(
  polyline: FleetLatLng[],
  maxPoints: number = FLEET_SLOT_MAX_POINTS,
): FleetLatLng[] {
  if (!polyline.length) return [];
  if (polyline.length <= maxPoints) return polyline.slice();

  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    const len = haversineM(polyline[i - 1].lat, polyline[i - 1].lng, polyline[i].lat, polyline[i].lng);
    segLens.push(len);
    total += len;
  }
  if (total <= 0.5) return [polyline[0], polyline[polyline.length - 1]];

  const out: FleetLatLng[] = [];
  for (let k = 0; k < maxPoints; k++) {
    const targetM = (k / (maxPoints - 1)) * total;
    let walked = 0;
    for (let i = 1; i < polyline.length; i++) {
      const seg = segLens[i - 1];
      if (walked + seg >= targetM || i === polyline.length - 1) {
        const segT = seg > 0 ? (targetM - walked) / seg : 0;
        out.push({
          lat: lerp(polyline[i - 1].lat, polyline[i].lat, clamp01(segT)),
          lng: lerp(polyline[i - 1].lng, polyline[i].lng, clamp01(segT)),
        });
        break;
      }
      walked += seg;
    }
  }
  if (!out.length) return polyline.slice(0, maxPoints);
  return out;
}

/** Trail z timestampami rozłożonymi między prevAt a lastAt. */
export function trailFromPolylineWithTimestamps(
  polyline: FleetLatLng[],
  prevAt: number,
  lastAt: number,
  maxPoints: number = FLEET_SLOT_MAX_POINTS,
): FleetTrailPoint[] {
  const sampled = samplePolylineForSlot(polyline, maxPoints);
  if (sampled.length < 2) return [];
  const dt = Math.max(50, lastAt - prevAt);
  return sampled.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    t: prevAt + (dt * i) / (sampled.length - 1),
  }));
}

function moveAlongBearingJs(lat: number, lng: number, headingDeg: number, distM: number) {
  if (distM <= 0) return { lat, lng };
  const R = 6371000;
  const br = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distM / R)
    + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(br),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(distM / R) * Math.cos(lat1),
    Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** Po ostatnim fixie — dead reckoning wzdłuż heading (wypełnia luki między pakietami). */
export function extrapolateFleetPosition(
  lat: number,
  lng: number,
  heading: number,
  speedMps: number,
  lastServerAt: number,
  nowMs: number,
  maxExtrapMs = FLEET_EXTRAPOLATE_MAX_MS,
): { lat: number; lng: number; heading: number } {
  const ageMs = nowMs - lastServerAt;
  if (!Number.isFinite(ageMs) || ageMs <= 0 || !Number.isFinite(speedMps) || speedMps < 0.8) {
    return { lat, lng, heading };
  }
  const cappedMs = Math.min(ageMs, maxExtrapMs);
  const distM = speedMps * (cappedMs / 1000);
  const moved = moveAlongBearingJs(lat, lng, heading, distM);
  return { lat: moved.lat, lng: moved.lng, heading };
}

/**
 * Trail do animacji — z socketu lub syntetyczny prev→server + punkt ekstrapolacji.
 */
export function buildAnimationTrail(input: {
  trail?: FleetTrailPoint[];
  prevServerLat?: number | null;
  prevServerLng?: number | null;
  prevServerAt?: number | null;
  serverLat: number;
  serverLng: number;
  serverAt: number;
  heading?: number | null;
  speedMps?: number | null;
}): FleetTrailPoint[] {
  const {
    trail,
    prevServerLat,
    prevServerLng,
    prevServerAt,
    serverLat,
    serverLng,
    serverAt,
    heading,
    speedMps,
  } = input;

  if (trail && trail.length >= 2 && !isTrailChordFlat(trail)) {
    const last = trail[trail.length - 1];
    const segMs = Math.max(
      FLEET_MIN_SEGMENT_MS,
      serverAt - (trail[0]?.t ?? serverAt - FLEET_MIN_SEGMENT_MS),
    );
    const hdg = Number.isFinite(heading)
      ? Number(heading)
      : bearingDeg(last.lat, last.lng, serverLat, serverLng);
    const extrap = extrapolateFleetPosition(
      last.lat,
      last.lng,
      hdg,
      speedMps ?? 0,
      last.t ?? serverAt,
      (last.t ?? serverAt) + segMs,
      FLEET_EXTRAPOLATE_MAX_MS,
    );
    const extended = [
      ...trail.slice(0, -1),
      { lat: last.lat, lng: last.lng, t: last.t ?? serverAt },
      { lat: extrap.lat, lng: extrap.lng, t: (last.t ?? serverAt) + segMs },
    ];
    return extended.slice(-FLEET_SLOT_MAX_POINTS);
  }

  if (
    !Number.isFinite(prevServerLat ?? NaN)
    || !Number.isFinite(prevServerLng ?? NaN)
    || !Number.isFinite(prevServerAt ?? NaN)
    || (prevServerLat === serverLat && prevServerLng === serverLng)
  ) {
    return [];
  }

  const pLat = Number(prevServerLat);
  const pLng = Number(prevServerLng);
  const pAt = Number(prevServerAt);
  const segMs = Math.max(FLEET_MIN_SEGMENT_MS, serverAt - pAt);
  const hdg = Number.isFinite(heading)
    ? Number(heading)
    : bearingDeg(pLat, pLng, serverLat, serverLng);
  const extrap = extrapolateFleetPosition(
    serverLat,
    serverLng,
    hdg,
    speedMps ?? 0,
    serverAt,
    serverAt + segMs,
    FLEET_EXTRAPOLATE_MAX_MS,
  );

  return [
    { lat: pLat, lng: pLng, t: pAt },
    { lat: serverLat, lng: serverLng, t: serverAt },
    { lat: extrap.lat, lng: extrap.lng, t: serverAt + segMs },
  ].slice(-FLEET_SLOT_MAX_POINTS);
}
