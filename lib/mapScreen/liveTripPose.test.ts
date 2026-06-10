import { describe, expect, it } from 'vitest';
import { getLiveTripPose, resolveBestKnownPose } from './liveTripPose';

describe('resolveBestKnownPose', () => {
  it('falls back to userLocation when DR refs are empty', () => {
    const pose = resolveBestKnownPose({
      drLat: NaN,
      drLng: NaN,
      drHdg: 0,
      tripActive: false,
      userLocation: { latitude: 52.1, longitude: 21.0 },
      headingFallback: 90,
    });
    expect(pose).toEqual({ latitude: 52.1, longitude: 21.0, headingDeg: 90 });
  });

  it('prefers drLat over userLocation', () => {
    const pose = resolveBestKnownPose({
      drLat: 52.2,
      drLng: 21.1,
      drHdg: 45,
      tripActive: false,
      userLocation: { latitude: 52.1, longitude: 21.0 },
    });
    expect(pose).toEqual({ latitude: 52.2, longitude: 21.1, headingDeg: 45 });
  });
});

describe('getLiveTripPose', () => {
  it('uses lastGoodLoc when dr is invalid', () => {
    const pose = getLiveTripPose({
      drLat: NaN,
      drLng: NaN,
      drHdg: 0,
      tripActive: false,
      lastGoodLoc: { lat: 50, lng: 19 },
    });
    expect(pose?.latitude).toBe(50);
    expect(pose?.longitude).toBe(19);
  });
});
