import { bearingBetween } from '../../scripts/navigationUtils';

export type MarkerFeedV2State = {
  lat: number;
  lng: number;
  heading: number;
  at: number;
};

let feedState: MarkerFeedV2State | null = null;

export function resetMarkerFeedState(): void {
  feedState = null;
}

export function getMarkerFeedState(): MarkerFeedV2State | null {
  return feedState ? { ...feedState } : null;
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

function headingDeltaDeg(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Czas segmentu LERP = rzeczywisty odstęp GPS (zsynchronizowany z cadence, nie z prędkością). */
export function markerSegmentDurationMs(
  intervalMs: number,
  _speedKmh: number,
  isNavigating: boolean,
): number {
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 500;
  const scaled = Math.round(interval * 0.85);
  if (isNavigating) {
    return Math.max(150, Math.min(800, scaled));
  }
  return Math.max(120, Math.min(800, scaled));
}

/** Odetnij szum GPS prostopadły / w tył względem kierunku jazdy. */
export function clampMarkerTargetForward(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  headingDeg: number,
  speedKmh: number,
): { lat: number; lng: number } {
  const totalM = haversineM(fromLat, fromLng, toLat, toLng);
  if (totalM < 0.15 || speedKmh < 2.5) {
    return { lat: toLat, lng: toLng };
  }
  const cosLat = Math.cos((fromLat * Math.PI) / 180);
  const dNorthM = (toLat - fromLat) * 111_320;
  const dEastM = (toLng - fromLng) * 111_320 * Math.max(0.25, Math.abs(cosLat));
  const hdgRad = (headingDeg * Math.PI) / 180;
  const fwdM = dNorthM * Math.cos(hdgRad) + dEastM * Math.sin(hdgRad);
  if (fwdM < -0.6) {
    return { lat: fromLat, lng: fromLng };
  }
  if (speedKmh < 30 && totalM < 4 && fwdM < totalM * 0.4) {
    return { lat: fromLat, lng: fromLng };
  }
  if (fwdM < 0.25 && totalM < 2) {
    return { lat: fromLat, lng: fromLng };
  }
  return { lat: toLat, lng: toLng };
}

/** Krok w tył względem kierunku jazdy (yo-yo snap vs raw). */
export function isBackwardMarkerStep(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  headingDeg: number,
  minBackM = 1.8,
): boolean {
  const stepM = haversineM(fromLat, fromLng, toLat, toLng);
  if (stepM < minBackM) return false;
  const stepBearing = bearingBetween(fromLat, fromLng, toLat, toLng);
  const err = Math.abs(headingDeltaDeg(headingDeg, stepBearing));
  return err > 88;
}

export type MarkerFeedDecision = {
  lat: number;
  lng: number;
  heading: number;
  acceptPosition: boolean;
  headingOnly: boolean;
  durationMs: number;
};

/**
 * Jedna bramka przed pushTarget — odrzuca duplikaty, skoki w tył i złe duration.
 */
export function decideMarkerFeed(
  lat: number,
  lng: number,
  heading: number,
  speedKmh: number,
  opts: {
    intervalMs: number;
    isNavigating: boolean;
    isFreeDrive: boolean;
  },
): MarkerFeedDecision {
  const hdg = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0;
  const dur = markerSegmentDurationMs(opts.intervalMs, speedKmh, opts.isNavigating);

  if (!feedState) {
    return {
      lat,
      lng,
      heading: hdg,
      acceptPosition: true,
      headingOnly: false,
      durationMs: dur,
    };
  }

  const clamped = clampMarkerTargetForward(
    feedState.lat,
    feedState.lng,
    lat,
    lng,
    feedState.heading,
    speedKmh,
  );
  const useLat = clamped.lat;
  const useLng = clamped.lng;

  const dt = Date.now() - feedState.at;
  const distM = haversineM(feedState.lat, feedState.lng, useLat, useLng);

  if (distM < 0.35 && dt < 120) {
    return {
      lat: feedState.lat,
      lng: feedState.lng,
      heading: hdg,
      acceptPosition: false,
      headingOnly: Math.abs(headingDeltaDeg(feedState.heading, hdg)) >= 4,
      durationMs: Math.min(dur, 32),
    };
  }

  const refHdg = feedState.heading;
  if (
    speedKmh >= 5
    && isBackwardMarkerStep(feedState.lat, feedState.lng, useLat, useLng, refHdg, opts.isFreeDrive ? 2.2 : 1.5)
  ) {
    return {
      lat: feedState.lat,
      lng: feedState.lng,
      heading: hdg,
      acceptPosition: false,
      headingOnly: Math.abs(headingDeltaDeg(refHdg, hdg)) >= 5,
      durationMs: Math.min(dur, 24),
    };
  }

  const accepted = useLat !== feedState.lat || useLng !== feedState.lng;
  if (!accepted) {
    return {
      lat: feedState.lat,
      lng: feedState.lng,
      heading: hdg,
      acceptPosition: false,
      headingOnly: Math.abs(headingDeltaDeg(refHdg, hdg)) >= 4,
      durationMs: Math.min(dur, 32),
    };
  }

  return {
    lat: useLat,
    lng: useLng,
    heading: hdg,
    acceptPosition: true,
    headingOnly: false,
    durationMs: dur,
  };
}

export function commitMarkerFeedState(lat: number, lng: number, heading: number): void {
  feedState = {
    lat,
    lng,
    heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0,
    at: Date.now(),
  };
}
