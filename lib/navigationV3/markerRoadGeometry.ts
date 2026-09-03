export const ARC_TRANSITION_DIRECT_M = 4;
export const ARC_TRANSITION_ALIGNED_M = 8;
export const ARC_TRANSITION_MAX_HEADING_DEG = 45;

export function normalizeRoadHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function roadHeadingDeltaAbs(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Exact direction of the polyline segment occupied by localArcM. */
export function exactRoadSegmentHeading(
  points: { lat: number; lng: number }[],
  cumM: number[],
  localArcM: number,
  travelDirection: number,
  fallbackHeading: number,
): number {
  if (points.length < 2 || cumM.length < 2) return normalizeRoadHeading(fallbackHeading);
  const total = cumM[cumM.length - 1] ?? 0;
  const direction = travelDirection < 0 ? -1 : 1;
  const clamped = Math.max(0, Math.min(total, localArcM));
  // A 2 cm probe only resolves which side of a vertex owns the pose. It does
  // not average the bearing across a bend like the previous multi-metre chord.
  const probe = Math.max(0, Math.min(total, clamped + direction * 0.02));
  let segment = 0;
  for (let index = 0; index < cumM.length - 1; index += 1) {
    if (probe < cumM[index + 1] || index === cumM.length - 2) {
      segment = index;
      break;
    }
  }
  const a = points[segment];
  const b = points[segment + 1];
  if (!a || !b) return normalizeRoadHeading(fallbackHeading);
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const forward = normalizeRoadHeading(Math.atan2(y, x) * 180 / Math.PI);
  return normalizeRoadHeading(forward + (direction < 0 ? 180 : 0));
}

export function shouldAcceptArcGeometryTransition(input: {
  hasCurrentGeometry: boolean;
  allowInstant: boolean;
  projectionDistanceM: number | null;
  candidateHeadingDeg: number;
  travelHeadingDeg: number;
}): boolean {
  if (!input.hasCurrentGeometry || input.allowInstant) return true;
  const distanceM = input.projectionDistanceM;
  if (distanceM == null || !Number.isFinite(distanceM)) return false;
  if (distanceM <= ARC_TRANSITION_DIRECT_M) return true;
  return distanceM <= ARC_TRANSITION_ALIGNED_M
    && roadHeadingDeltaAbs(input.candidateHeadingDeg, input.travelHeadingDeg)
      <= ARC_TRANSITION_MAX_HEADING_DEG;
}
