export const TRIP_MOTION = {
  smallErrorHalfLifeMs: 120,
  largeErrorHalfLifeMs: 180,
  /** Off-road / GPS course — mild smoothing for noisy bearings. */
  headingHalfLifeMs: 85,
  headingMaxDps: 360,
  /** On-road polyline tangent — snappy like a real car (roundabouts). */
  onRoadHeadingHalfLifeMs: 42,
  onRoadHeadingMaxDps: 720,
  headingNoiseFloorDeg: 0.18,
  minimumFuturePredictionMs: 900,
  maximumPredictionMs: 4_000,
  predictionCadenceMultiplier: 1.8,
  predictionJitterMultiplier: 2,
  predictionFadeMs: 700,
  roadPredictionMaxM: 80,
  freePredictionMaxM: 35,
  hardSnapDistanceM: 45,
  staleSampleMs: 10_000,
  /** One time-based display segment per GPS fix. */
  segmentDurationDefaultMs: 1_000,
  segmentDurationMinMs: 200,
  segmentDurationMaxMs: 2_000,
  largeCorrectionDurationMs: 300,
  accelerationEma: 0.35,
  accelerationMinMs2: -7,
  accelerationMaxMs2: 4,
  stoppedSpeedMs: 3 / 3.6,
} as const;

export function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function linearSegmentProgress(elapsedMs: number, durationMs: number): number {
  const safeDuration = Math.max(
    TRIP_MOTION.segmentDurationMinMs,
    Math.min(
      TRIP_MOTION.segmentDurationMaxMs,
      Number.isFinite(durationMs) ? durationMs : TRIP_MOTION.segmentDurationDefaultMs,
    ),
  );
  return Math.max(0, Math.min(1, elapsedMs / safeDuration));
}

export function interpolateLinearSegment(start: number, target: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return start + (target - start) * t;
}

export function shortestHeadingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function interpolateHeadingShortest(start: number, target: number, progress: number): number {
  const result = start + shortestHeadingDelta(start, target) * Math.max(0, Math.min(1, progress));
  return ((result % 360) + 360) % 360;
}

export function markerScreenHeading(
  worldHeading: number,
  cameraBearing: number,
  cameraMode: 'courseUp' | 'northUp' | 'free',
  following: boolean,
): number {
  if (following && cameraMode === 'courseUp') return 0;
  return ((worldHeading - cameraBearing) % 360 + 360) % 360;
}

export function predictMotionAtAge(
  sampleSpeedMs: number,
  accelerationMs2: number,
  sourceAgeMs: number,
  predictionHorizonMs: number,
  maxDistanceM: number,
): { distanceM: number; speedMs: number } {
  'worklet';
  const speed0 = Math.max(0, sampleSpeedMs);
  const acceleration = Math.max(
    TRIP_MOTION.accelerationMinMs2,
    Math.min(TRIP_MOTION.accelerationMaxMs2, accelerationMs2),
  );
  const horizonSec = Math.max(0, predictionHorizonMs) / 1000;
  const requestedAgeSec = Math.max(0, sourceAgeMs) / 1000;
  const activeSec = Math.min(requestedAgeSec, horizonSec);
  const stopSec = acceleration < 0 ? speed0 / -acceleration : Number.POSITIVE_INFINITY;
  const integratedSec = Math.min(activeSec, stopSec);
  const activeDistance = Math.max(
    0,
    speed0 * integratedSec + 0.5 * acceleration * integratedSec * integratedSec,
  );
  const horizonSpeed = Math.max(0, speed0 + acceleration * integratedSec);
  const fadeSec = TRIP_MOTION.predictionFadeMs / 1000;
  const fadeElapsedSec = Math.min(fadeSec, Math.max(0, requestedAgeSec - horizonSec));
  const fadeRatio = fadeSec > 0 ? fadeElapsedSec / fadeSec : 1;
  const fadeDistance = horizonSpeed * fadeElapsedSec * (1 - 0.5 * fadeRatio);
  return {
    distanceM: Math.min(maxDistanceM, activeDistance + fadeDistance),
    speedMs: requestedAgeSec <= horizonSec
      ? horizonSpeed
      : horizonSpeed * Math.max(0, 1 - fadeRatio),
  };
}
