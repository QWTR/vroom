import { describe, expect, it } from 'vitest';
import type { TripStats } from '../hooks/useTripStats';
import { resolveTripSummaryPresentation } from './tripSummaryPresentation';

const local: TripStats = {
  tripSessionId: 'trip_locked',
  distanceKm: 3.4,
  elapsedSec: 313,
  avgSpeedKmh: 42,
  maxSpeedKmh: 70,
  estimatedSec: 0,
  trackedPoints: [
    { latitude: 54.1, longitude: 22.9 },
    { latitude: 54.2, longitude: 23.0 },
  ],
};

describe('trip summary presentation', () => {
  it('replaces a suspended JS snapshot with the saved native route and stats', () => {
    const nativeRoute = [
      { latitude: 54.1, longitude: 22.9, speedKmh: 30 },
      { latitude: 54.15, longitude: 22.93, speedKmh: 55 },
      { latitude: 54.18, longitude: 22.97, speedKmh: 65 },
      { latitude: 54.2, longitude: 23.0, speedKmh: 50 },
    ];
    const result = resolveTripSummaryPresentation(local, {
      availability: { timeline: true },
      summary: {
        distanceKm: 4.1,
        durationSec: 360,
        movingDurationSec: 330,
        stoppedDurationSec: 30,
        avgSpeedKmh: 51,
        maxSpeedKmh: 72,
      },
      routePoints: nativeRoute,
    });

    expect(result).toMatchObject({
      distanceKm: 4.1,
      elapsedSec: 360,
      movingSec: 330,
      stoppedSec: 30,
      avgSpeedKmh: 51,
      maxSpeedKmh: 72,
    });
    expect(result.points).toEqual(nativeRoute);
  });

  it('keeps local values until a complete server snapshot is available', () => {
    expect(resolveTripSummaryPresentation(local, {
      availability: { timeline: false },
      summary: {},
      routePoints: [{ latitude: 54.1, longitude: 22.9 }],
    })).toMatchObject({
      distanceKm: 3.4,
      elapsedSec: 313,
      movingSec: 313,
      stoppedSec: 0,
      avgSpeedKmh: 42,
      maxSpeedKmh: 70,
      points: local.trackedPoints,
    });
  });
});
