export type FleetTrailPoint = {
  lat: number;
  lng: number;
  t: number;
};

export type FleetLatLng = { lat: number; lng: number };

const MAX_IMPLAUSIBLE_SPEED_MPS = 55;

export function parseIncomingTrail(raw: unknown): FleetTrailPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: FleetTrailPoint[] = [];
  for (const pt of raw.slice(-4)) {
    const lat = Number((pt as FleetTrailPoint)?.lat);
    const lng = Number((pt as FleetTrailPoint)?.lng);
    const t = Number((pt as FleetTrailPoint)?.t);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng, t: Number.isFinite(t) ? t : Date.now() });
  }
  return out;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
  let acc = 0;
  const segLens: number[] = [];
  for (let i = 1; i < trail.length; i++) {
    const len = haversineM(trail[i - 1].lat, trail[i - 1].lng, trail[i].lat, trail[i].lng);
    segLens.push(len);
    acc += len;
  }
  if (acc <= 0.5) {
    const tail = trail[trail.length - 1];
    return { lat: tail.lat, lng: tail.lng, heading: 0 };
  }

  const targetM = tNorm * acc;
  let walked = 0;
  for (let i = 1; i < trail.length; i++) {
    const seg = segLens[i - 1];
    if (walked + seg >= targetM) {
      const segT = seg > 0 ? (targetM - walked) / seg : 0;
      const lat = lerp(trail[i - 1].lat, trail[i].lat, segT);
      const lng = lerp(trail[i - 1].lng, trail[i].lng, segT);
      return {
        lat,
        lng,
        heading: bearingDeg(trail[i - 1].lat, trail[i - 1].lng, trail[i].lat, trail[i].lng),
      };
    }
    walked += seg;
  }

  const tail = trail[trail.length - 1];
  const prev = trail[trail.length - 2];
  return {
    lat: tail.lat,
    lng: tail.lng,
    heading: bearingDeg(prev.lat, prev.lng, tail.lat, tail.lng),
  };
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
  let acc = 0;
  const segLens: number[] = [];
  for (let i = 1; i < polyline.length; i++) {
    const len = haversineM(polyline[i - 1].lat, polyline[i - 1].lng, polyline[i].lat, polyline[i].lng);
    segLens.push(len);
    acc += len;
  }
  if (acc <= 0.5) {
    const tail = polyline[polyline.length - 1];
    return { lat: tail.lat, lng: tail.lng, heading: 0 };
  }

  const targetM = tNorm * acc;
  let walked = 0;
  for (let i = 1; i < polyline.length; i++) {
    const seg = segLens[i - 1];
    if (walked + seg >= targetM) {
      const segT = seg > 0 ? (targetM - walked) / seg : 0;
      const lat = lerp(polyline[i - 1].lat, polyline[i].lat, segT);
      const lng = lerp(polyline[i - 1].lng, polyline[i].lng, segT);
      return {
        lat,
        lng,
        heading: bearingDeg(polyline[i - 1].lat, polyline[i - 1].lng, polyline[i].lat, polyline[i].lng),
      };
    }
    walked += seg;
  }

  const tail = polyline[polyline.length - 1];
  const prev = polyline[polyline.length - 2];
  return {
    lat: tail.lat,
    lng: tail.lng,
    heading: bearingDeg(prev.lat, prev.lng, tail.lat, tail.lng),
  };
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

export function resolveFleetAnimationTier(
  isFriend: boolean,
  distKm: number,
  fullRadiusKm: number,
): 'full' | 'static' {
  if (isFriend) return 'full';
  if (!Number.isFinite(distKm) || distKm <= fullRadiusKm) return 'full';
  return 'static';
}
