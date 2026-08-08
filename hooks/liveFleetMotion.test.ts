import { describe, expect, it } from 'vitest';
import {
  FLEET_INTERPOLATION_BUFFER_MS,
  FLEET_REDUCED_UPDATE_MS,
  resolveFleetMotionTier,
  shouldApplyReducedFleetUpdate,
  shouldPublishFleetFrame,
  shouldRenderFleet2dPin,
  shouldExtrapolatePastTrailTail,
} from './liveFleetMotion';

describe('liveFleetMotion tiers', () => {
  it('keeps every friend in the full tier regardless of distance', () => {
    expect(resolveFleetMotionTier({
      isFriend: true,
      viewerLat: 52,
      viewerLng: 21,
      incomingLat: 52,
      incomingLng: 23,
    })).toBe('full');
  });

  it('uses full tier inside 10km and reduced tier outside', () => {
    expect(resolveFleetMotionTier({
      viewerLat: 52,
      viewerLng: 21,
      incomingLat: 52.089,
      incomingLng: 21,
    })).toBe('full');
    expect(resolveFleetMotionTier({
      viewerLat: 52,
      viewerLng: 21,
      incomingLat: 52.101,
      incomingLng: 21,
    })).toBe('reduced');
  });

  it('honors a tier assigned by a compatible server', () => {
    expect(resolveFleetMotionTier({
      serverTier: 'full',
      viewerLat: null,
      viewerLng: null,
      incomingLat: 52,
      incomingLng: 21,
    })).toBe('full');
    expect(resolveFleetMotionTier({
      serverTier: 'reduced',
      viewerLat: 52,
      viewerLng: 21,
      incomingLat: 52,
      incomingLng: 21,
    })).toBe('reduced');
  });

  it('coalesces reduced updates to ten seconds', () => {
    expect(shouldApplyReducedFleetUpdate(1_000, 0)).toBe(true);
    expect(shouldApplyReducedFleetUpdate(1_000 + FLEET_REDUCED_UPDATE_MS - 1, 1_000)).toBe(false);
    expect(shouldApplyReducedFleetUpdate(1_000 + FLEET_REDUCED_UPDATE_MS, 1_000)).toBe(true);
  });

  it('targets 60Hz for hot GeoJSON publishing', () => {
    expect(shouldPublishFleetFrame(1_000, 0)).toBe(true);
    expect(shouldPublishFleetFrame(1_010, 1_000)).toBe(false);
    expect(shouldPublishFleetFrame(1_016, 1_000)).toBe(true);
  });

  it('keeps the 2D marker and extrapolates after the trail tail', () => {
    expect(shouldRenderFleet2dPin(0, 0)).toBe(true);
    expect(shouldRenderFleet2dPin(1, 1)).toBe(true);
    expect(shouldExtrapolatePastTrailTail(2_001, 2_000)).toBe(true);
    expect(shouldExtrapolatePastTrailTail(2_000, 2_000)).toBe(false);
  });

  it('uses the agreed 350ms interpolation buffer', () => {
    expect(FLEET_INTERPOLATION_BUFFER_MS).toBe(350);
  });
});
