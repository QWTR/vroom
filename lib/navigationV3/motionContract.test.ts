import { describe, expect, it } from 'vitest';
import {
  interpolateHeadingShortest,
  interpolateLinearSegment,
  linearSegmentProgress,
  markerScreenHeading,
  predictMotionAtAge,
  shortestHeadingDelta,
  smoothstep01,
  TRIP_MOTION,
} from './motionContract';

describe('shared trip motion contract', () => {
  it('uses adaptive correction and prediction windows', () => {
    expect(TRIP_MOTION.smallErrorHalfLifeMs).toBe(120);
    expect(TRIP_MOTION.largeErrorHalfLifeMs).toBe(180);
    expect(TRIP_MOTION.maximumPredictionMs).toBe(4_000);
    expect(TRIP_MOTION.staleSampleMs).toBe(10_000);
  });

  it('allows delayed motorway fixes without unbounded ghost driving', () => {
    expect(TRIP_MOTION.roadPredictionMaxM).toBe(80);
    expect(TRIP_MOTION.freePredictionMaxM).toBe(35);
    expect(TRIP_MOTION.predictionFadeMs).toBe(700);
    expect(TRIP_MOTION.headingMaxDps).toBe(360);
    expect(TRIP_MOTION.onRoadHeadingMaxDps).toBe(720);
  });

  it.each([200, 500, 1_000, 2_000])('finishes a %d ms segment exactly on target', (durationMs) => {
    expect(linearSegmentProgress(0, durationMs)).toBe(0);
    expect(linearSegmentProgress(durationMs / 2, durationMs)).toBe(0.5);
    expect(linearSegmentProgress(durationMs, durationMs)).toBe(1);
    expect(interpolateLinearSegment(10, 20, linearSegmentProgress(durationMs, durationMs))).toBe(20);
  });

  it('retargets continuously from the currently rendered value', () => {
    const rendered = interpolateLinearSegment(0, 10, 0.4);
    expect(interpolateLinearSegment(rendered, 20, 0)).toBe(rendered);
  });

  it('always crosses north using the shortest heading path', () => {
    expect(shortestHeadingDelta(359, 1)).toBe(2);
    expect(shortestHeadingDelta(1, 359)).toBe(-2);
    expect(interpolateHeadingShortest(359, 1, 0.5)).toBe(0);
    expect(interpolateHeadingShortest(1, 359, 0.5)).toBe(0);
  });

  it('uses the exact camera-relative marker rotation in every camera mode', () => {
    expect(markerScreenHeading(110, 123, 'courseUp', true)).toBe(347);
    expect(markerScreenHeading(123, 0, 'northUp', true)).toBe(123);
    expect(markerScreenHeading(10, 350, 'free', false)).toBe(20);
  });

  it('clamps smoothstep and keeps its midpoint stable', () => {
    expect(smoothstep01(-1)).toBe(0);
    expect(smoothstep01(0.5)).toBe(0.5);
    expect(smoothstep01(2)).toBe(1);
  });

  it('advances a delayed fix to current time without changing cruise speed', () => {
    expect(predictMotionAtAge(10, 0, 1_000, 2_000, 80)).toEqual({
      distanceM: 10,
      speedMs: 10,
    });
  });

  it('reacts to acceleration and braking in the same accepted sample', () => {
    const accelerating = predictMotionAtAge(10, 2, 500, 2_000, 80);
    expect(accelerating.distanceM).toBeCloseTo(5.25, 5);
    expect(accelerating.speedMs).toBeCloseTo(11, 5);

    const braking = predictMotionAtAge(10, -4, 500, 2_000, 80);
    expect(braking.distanceM).toBeCloseTo(4.5, 5);
    expect(braking.speedMs).toBeCloseTo(8, 5);
  });

  it('fades prediction instead of stopping on a single frame', () => {
    const atHorizon = predictMotionAtAge(10, 0, 1_000, 1_000, 80);
    const duringFade = predictMotionAtAge(10, 0, 1_350, 1_000, 80);
    const afterFade = predictMotionAtAge(10, 0, 1_700, 1_000, 80);
    expect(atHorizon.speedMs).toBe(10);
    expect(duringFade.speedMs).toBeCloseTo(5, 5);
    expect(afterFade.speedMs).toBe(0);
    expect(duringFade.distanceM).toBeGreaterThan(atHorizon.distanceM);
    expect(afterFade.distanceM).toBeGreaterThan(duringFade.distanceM);
  });
});
