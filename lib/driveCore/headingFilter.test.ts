import {
  computeTripBearing,
  HeadingRingBuffer,
  TRAVEL_VECTOR_LOCK_SPEED_MS,
  TripHeadingFilter,
} from './headingFilter';

describe('HeadingRingBuffer', () => {
  it('averages angles across 0/360 wrap', () => {
    const ring = new HeadingRingBuffer(4);
    ring.push(359);
    ring.push(1);
    ring.push(0);
    const mean = ring.circularMean();
    expect(mean).not.toBeNull();
    expect(Math.abs(mean! - 0)).toBeLessThan(5);
  });

  it('keeps at most 4 samples', () => {
    const ring = new HeadingRingBuffer(4);
    for (let i = 0; i < 6; i++) ring.push(i * 10);
    expect(ring.circularMean()).not.toBeNull();
  });
});

describe('computeTripBearing', () => {
  const ring = new HeadingRingBuffer(4);

  beforeEach(() => ring.reset());

  it('uses movement vector above speed lock, ignores compass', () => {
    const h = computeTripBearing(
      {
        prevLat: 52.0,
        prevLng: 21.0,
        lat: 52.001,
        lng: 21.0,
        movedM: 111,
        speedMs: TRAVEL_VECTOR_LOCK_SPEED_MS + 1,
        snapHeading: 270,
        compassDeg: 90,
        prevHeading: 0,
      },
      ring,
    );
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(90);
  });

  it('escapes stuck 0° when real bearing arrives at speed', () => {
    ring.reset();
    const h = computeTripBearing(
      {
        prevLat: 51.211,
        prevLng: 19.024,
        lat: 51.211,
        lng: 19.024,
        movedM: 0.4,
        speedMs: 14,
        speedKmh: 51,
        snapHeading: 0,
        compassDeg: 248,
        prevHeading: 0,
      },
      ring,
    );
    expect(h).toBeGreaterThan(200);
    expect(h).toBeLessThan(270);
  });

  it('rejects 180 flip at driving speed', () => {
    ring.reset();
    const prev = 10;
    const h = computeTripBearing(
      {
        prevLat: 52.0,
        prevLng: 21.0,
        lat: 52.001,
        lng: 21.0,
        movedM: 50,
        speedMs: 15,
        snapHeading: 190,
        prevHeading: prev,
      },
      ring,
    );
    ring.push(190);
    const h2 = computeTripBearing(
      {
        prevLat: 52.001,
        prevLng: 21.0,
        lat: 52.0,
        lng: 21.0,
        movedM: 50,
        speedMs: 15,
        snapHeading: 10,
        prevHeading: h,
      },
      ring,
    );
    expect(Math.abs(((h2 - prev + 540) % 360) - 180)).toBeLessThan(92);
  });
});

describe('TripHeadingFilter', () => {
  it('persists smoothed heading across updates', () => {
    const f = new TripHeadingFilter();
    f.reset(0);
    const a = f.update({
      prevLat: 52,
      prevLng: 21,
      lat: 52.0005,
      lng: 21,
      movedM: 55,
      speedMs: 20,
      snapHeading: 45,
    });
    const b = f.update({
      prevLat: 52.0005,
      prevLng: 21,
      lat: 52.001,
      lng: 21,
      movedM: 55,
      speedMs: 20,
      snapHeading: 200,
    });
    expect(f.getLastHeading()).toBe(b);
    expect(Number.isFinite(a)).toBe(true);
  });
});
