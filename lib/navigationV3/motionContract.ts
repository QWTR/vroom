export const TRIP_MOTION = {
  smallErrorHalfLifeMs: 120,
  largeErrorHalfLifeMs: 180,
  headingHalfLifeMs: 80,
  minimumFuturePredictionMs: 900,
  maximumPredictionMs: 4_000,
  predictionCadenceMultiplier: 1.8,
  predictionJitterMultiplier: 2,
  predictionFadeMs: 700,
  roadPredictionMaxM: 80,
  freePredictionMaxM: 35,
  hardSnapDistanceM: 45,
  staleSampleMs: 10_000,
  headingMaxDps: 180,
  accelerationEma: 0.35,
  accelerationMinMs2: -7,
  accelerationMaxMs2: 4,
  stoppedSpeedMs: 3 / 3.6,
} as const;

export function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
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
