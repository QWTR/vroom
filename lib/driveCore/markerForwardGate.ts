import { clampMarkerTargetForward, isBackwardMarkerStep } from './markerFeedV2';

export const BACKWARD_ARC_EPS_M = 0.8;
export const BACKWARD_REJECT_MIN_HUD_KMH = 4;

export type ForwardGateInput = {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  headingDeg: number;
  hudKmh: number;
  arcM?: number;
  currentArcM?: number;
  polylineKey?: string;
  currentPolylineKey?: string;
};

export type ForwardGateResult = {
  acceptPosition: boolean;
  lat: number;
  lng: number;
  headingOnly: boolean;
};

/**
 * Odrzuca cofający LERP (arcM lub wektor ruchu) — eliminuje jojo markera.
 */
export function evaluateMarkerForwardGate(input: ForwardGateInput): ForwardGateResult {
  const {
    fromLat,
    fromLng,
    toLat,
    toLng,
    headingDeg,
    hudKmh,
    arcM,
    currentArcM,
    polylineKey,
    currentPolylineKey,
  } = input;

  const hasArc =
    Number.isFinite(arcM)
    && Number.isFinite(currentArcM)
    && polylineKey != null
    && polylineKey.length > 0
    && polylineKey === currentPolylineKey;

  if (
    hasArc
    && hudKmh >= BACKWARD_REJECT_MIN_HUD_KMH
    && (arcM as number) < (currentArcM as number) - BACKWARD_ARC_EPS_M
  ) {
    return {
      acceptPosition: false,
      lat: fromLat,
      lng: fromLng,
      headingOnly: true,
    };
  }

  if (
    hudKmh >= 5
    && isBackwardMarkerStep(fromLat, fromLng, toLat, toLng, headingDeg, 1.5)
  ) {
    return {
      acceptPosition: false,
      lat: fromLat,
      lng: fromLng,
      headingOnly: true,
    };
  }

  const clamped = clampMarkerTargetForward(
    fromLat,
    fromLng,
    toLat,
    toLng,
    headingDeg,
    hudKmh,
  );

  return {
    acceptPosition: true,
    lat: clamped.lat,
    lng: clamped.lng,
    headingOnly: false,
  };
}
