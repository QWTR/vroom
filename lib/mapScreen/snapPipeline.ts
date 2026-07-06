import { haversineKm } from '../../scripts/navigationUtils';
import { logGpsTickLayer } from '../gpsTickTraceLog';
import { visionEvent } from '../driveVisionTrace';
import { projectOntoDrivingRoad, clampCoordStep } from './snapGeometry';
import { isStepBackwardAlongHeading } from './tripMarkerMotion';
import { maxPlausibleDrivingStepM } from './gpsSanity';

export function reconcileV10ApplyWithGpsTruth(
  applyLat: number,
  applyLng: number,
  anchor: { lat: number; lng: number },
  rawLat: number,
  rawLng: number,
  speedMs: number,
  kmh: number,
  headingDeg: number,
  roadPts: { latitude: number; longitude: number }[] = [],
): { lat: number; lng: number; reason: string | null } {
  const onRoadRaw = (() => {
    if (roadPts.length < 2) return null;
    const p = projectOntoDrivingRoad(rawLat, rawLng, rawLat, rawLng, roadPts, 52);
    return p ? { lat: p.latitude, lng: p.longitude } : null;
  })();
  const rawTruthLat = onRoadRaw?.lat ?? rawLat;
  const rawTruthLng = onRoadRaw?.lng ?? rawLng;
  const maxStep = maxPlausibleDrivingStepM(speedMs, kmh);
  // Postój: nie ciągnij do surowego GPS — to losowe teleporty na trawnik.
  if (kmh < 2 && speedMs < 0.65) {
    const applyJumpMStill = haversineKm(anchor.lat, anchor.lng, applyLat, applyLng) * 1000;
    if (applyJumpMStill <= 6) {
      return { lat: applyLat, lng: applyLng, reason: null };
    }
    const c = clampCoordStep(
      { latitude: anchor.lat, longitude: anchor.lng },
      { latitude: applyLat, longitude: applyLng },
      3,
    );
    return { lat: c.latitude, lng: c.longitude, reason: 'stationary_clamp_apply' };
  }
  const applyJumpM = haversineKm(anchor.lat, anchor.lng, applyLat, applyLng) * 1000;
  const rawJumpM = haversineKm(anchor.lat, anchor.lng, rawTruthLat, rawTruthLng) * 1000;
  const applyToRawM = haversineKm(applyLat, applyLng, rawTruthLat, rawTruthLng) * 1000;
  const forbidRawTruth = roadPts.length >= 2;

  if (applyJumpM <= maxStep && applyToRawM <= 48) {
    return { lat: applyLat, lng: applyLng, reason: null };
  }
  // Nigdy nie ciągnij markera do surowego GPS po skoku >45 m — to właśnie „teleport w pizdu”.
  if (
    !forbidRawTruth
    && rawJumpM <= maxStep * 1.25
    && rawJumpM <= 45
    && applyToRawM >= 22
    && applyToRawM <= 52
    && !isStepBackwardAlongHeading(anchor.lat, anchor.lng, rawTruthLat, rawTruthLng, headingDeg)
  ) {
    return { lat: rawTruthLat, lng: rawTruthLng, reason: 'snap_to_raw_truth' };
  }
  if (applyJumpM > maxStep) {
    if (
      !forbidRawTruth
      && rawJumpM < applyJumpM * 0.7
      && rawJumpM <= 45
      && applyToRawM > 18
      && !isStepBackwardAlongHeading(anchor.lat, anchor.lng, rawTruthLat, rawTruthLng, headingDeg)
    ) {
      return { lat: rawTruthLat, lng: rawTruthLng, reason: 'raw_closer_than_apply' };
    }
    const c = clampCoordStep(
      { latitude: anchor.lat, longitude: anchor.lng },
      { latitude: applyLat, longitude: applyLng },
      maxStep,
    );
    return { lat: c.latitude, lng: c.longitude, reason: 'clamp_apply_jump' };
  }
  if (applyToRawM > 42) {
    // WYŁĄCZONE pull_toward_raw — logi mpmkymfa: marker skacze do przodu, reconcile
    // cofał go do surowego GPS (wstecz), następny tick znowu do przodu → szarpanie 1-2-3-4.
    if (applyJumpM > maxStep) {
      const c = clampCoordStep(
        { latitude: anchor.lat, longitude: anchor.lng },
        { latitude: applyLat, longitude: applyLng },
        maxStep,
      );
      return { lat: c.latitude, lng: c.longitude, reason: 'clamp_apply_keep_snap' };
    }
    return { lat: applyLat, lng: applyLng, reason: null };
  }
  return { lat: applyLat, lng: applyLng, reason: null };
}

export function logSnapPipelineEnd(
  rawLat: number,
  rawLng: number,
  applyLat: number,
  applyLng: number,
  extra?: Record<string, unknown>,
): void {
  const rawToApplyM = haversineKm(rawLat, rawLng, applyLat, applyLng) * 1000;
  const offRoadLeak = rawToApplyM >= 35;
  logGpsTickLayer('SNAP_PIPELINE_END', {
    rawLat: Number(rawLat.toFixed(6)),
    rawLng: Number(rawLng.toFixed(6)),
    applyLat: Number(applyLat.toFixed(6)),
    applyLng: Number(applyLng.toFixed(6)),
    rawToApplyM: Math.round(rawToApplyM),
    offRoadLeak,
    ...(extra ?? {}),
  });
  if (offRoadLeak) {
    visionEvent('OFF_ROAD', {
      rawLat: Number(rawLat.toFixed(6)),
      rawLng: Number(rawLng.toFixed(6)),
      snapLat: Number(applyLat.toFixed(6)),
      snapLng: Number(applyLng.toFixed(6)),
      crossTrackM: Math.round(rawToApplyM),
      action: 'snap_pipeline_leak',
      ...(extra ?? {}),
    });
  }
}
