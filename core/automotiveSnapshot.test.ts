import { describe, expect, it } from 'vitest';
import {
  AUTOMOTIVE_SNAPSHOT_SCHEMA_VERSION,
  createAutomotiveSnapshot,
  nextAutomotiveRevision,
  normalizeAutomotiveNavigationStarted,
} from './automotiveSnapshot';

describe('AutomotiveSnapshot', () => {
  it('creates a versioned, monotonic snapshot shared by Android Auto and CarPlay', () => {
    const first = createAutomotiveSnapshot({
      isNavigating: true,
      dto: { nextInstruction: 'Skręć w prawo' },
      route: [{ lat: 52.1, lng: 21.0 }],
      destination: { latitude: 52.2, longitude: 21.1, name: 'Cel' },
      userLocation: { latitude: 52.1, longitude: 21.0 },
      speedMetersPerSecond: 12.5,
      heading: 181,
      users: [],
      warnings: [],
      mapState: { mapStyle: 'dark' },
      now: 1_000,
    });
    const second = createAutomotiveSnapshot({
      isNavigating: false,
      dto: {},
      route: [],
      destination: null,
      users: [],
      warnings: [],
      mapState: {},
      now: 1_000,
    });

    expect(first.schemaVersion).toBe(AUTOMOTIVE_SNAPSHOT_SCHEMA_VERSION);
    expect(first.source).toBe('phone');
    expect(first.speed).toBe(12.5);
    expect(second.revision).toBeGreaterThan(first.revision);
  });

  it('keeps revisions increasing when the clock goes backwards', () => {
    const first = nextAutomotiveRevision(10_000);
    const second = nextAutomotiveRevision(2_000);
    expect(second).toBe(first + 1);
  });

  it('normalizes a native CarPlay route event into the existing phone contract', () => {
    const event = normalizeAutomotiveNavigationStarted({
      source: 'carplay',
      destination: {
        name: 'Warszawa',
        latitude: 52.2297,
        longitude: 21.0122,
      },
      route: [
        { latitude: 52.1, longitude: 21.0 },
        { latitude: 52.2297, longitude: 21.0122 },
      ],
      routeSteps: [{ instruction: 'Jedź prosto' }],
      distanceM: 14_200,
      durationS: 1_100,
    });

    expect(event).toMatchObject({
      destination: { name: 'Warszawa' },
      distanceMeters: 14_200,
      durationSeconds: 1_100,
      instruction: 'Jedź prosto',
      routePreview: false,
    });
    expect(event?.routePoints).toHaveLength(2);
  });

  it('rejects malformed and too-short routes', () => {
    expect(normalizeAutomotiveNavigationStarted('{broken')).toBeNull();
    expect(normalizeAutomotiveNavigationStarted({
      route: [{ latitude: 52, longitude: 21 }],
    })).toBeNull();
  });
});
