import { describe, expect, it } from 'vitest';
import {
  createTripSessionLedger,
  markLedgerFinalizationPending,
  mergeForegroundLedgerSnapshot,
  mergeNativeLedgerSnapshot,
  compactTripRoute,
  resolveTripSessionIdentity,
  shouldSnapshotLedger,
} from './tripSessionLedger';

describe('trip session ledger', () => {
  it('never shrinks a native session after a crash/restart snapshot', () => {
    const initial = mergeNativeLedgerSnapshot(null, {
      tripSessionId: 'trip_30km',
      mode: 'navigation',
      distanceKm: 13,
      checkpointKm: 12.8,
      routePoints: [{ latitude: 52, longitude: 21 }, { latitude: 52.01, longitude: 21.01 }],
    });
    const resumed = mergeNativeLedgerSnapshot(initial, {
      tripSessionId: 'trip_30km',
      mode: 'navigation',
      distanceKm: 30,
      checkpointKm: 30,
      routePoints: [{ latitude: 52.01, longitude: 21.01 }, { latitude: 52.02, longitude: 21.02 }],
    });

    expect(resumed.distanceKm).toBe(30);
    expect(resumed.checkpointKm).toBe(30);
    expect(resumed.routePoints).toHaveLength(3);
  });

  it('keeps one session across navigation and Free Drive', () => {
    const navigating = mergeNativeLedgerSnapshot(null, {
      tripSessionId: 'trip_continuous',
      mode: 'navigation',
      distanceKm: 8.4,
    });
    const freeDrive = mergeNativeLedgerSnapshot(navigating, {
      tripSessionId: 'trip_continuous',
      mode: 'freeDrive',
      distanceKm: 14.7,
    });

    expect(freeDrive.tripSessionId).toBe('trip_continuous');
    expect(freeDrive.mode).toBe('freeDrive');
    expect(freeDrive.distanceKm).toBe(14.7);
  });

  it('persists a finalization boundary without deleting the distance', () => {
    const open = mergeForegroundLedgerSnapshot(
      createTripSessionLedger({ tripSessionId: 'trip_final', now: 1_000 }),
      { distanceKm: 30, mode: 'freeDrive', now: 6_000 },
    );
    const pending = markLedgerFinalizationPending(open, 'idle', 7_000);

    expect(pending).toMatchObject({
      active: false,
      distanceKm: 30,
      finalization: { state: 'pending', reason: 'idle' },
    });
    expect(shouldSnapshotLedger(open, pending)).toBe(true);
  });

  it('keeps a cancelled navigation eligible for history even without geometry', () => {
    const running = mergeForegroundLedgerSnapshot(
      createTripSessionLedger({ tripSessionId: 'trip_cancelled_early', mode: 'navigation', now: 1_000 }),
      { distanceKm: 0.2, mode: 'navigation', routePoints: [], now: 3_000 },
    );
    const pending = markLedgerFinalizationPending(running, 'manual', 4_000);

    expect(pending).toMatchObject({
      active: false,
      mode: 'navigation',
      distanceKm: 0.2,
      routePoints: [],
      finalization: { state: 'pending', reason: 'manual' },
    });
  });

  it('ignores a stale inactive native session id and keeps the JS session authoritative', () => {
    expect(resolveTripSessionIdentity({
      jsSessionId: 'trip_current',
      nativeStateActive: false,
      nativeStateSessionId: 'trip_old',
      nativeStatsSessionId: 'trip_old',
    })).toEqual({
      sessionId: 'trip_current',
      acceptNativeStats: false,
      conflict: true,
    });
  });

  it('accepts the final native snapshot only when it belongs to the JS session', () => {
    expect(resolveTripSessionIdentity({
      jsSessionId: 'trip_current',
      nativeStateActive: false,
      nativeStateSessionId: 'trip_current',
      nativeStatsSessionId: 'trip_current',
    })).toMatchObject({ sessionId: 'trip_current', acceptNativeStats: true, conflict: false });
  });

  it('deduplicates and compacts geometry while preserving both ends', () => {
    const route = Array.from({ length: 2_100 }, (_, index) => ({
      latitude: 50 + index / 100_000,
      longitude: 19 + index / 100_000,
    }));
    route.splice(10, 0, route[9]);
    const compacted = compactTripRoute(route);

    expect(compacted.length).toBeLessThanOrEqual(1_500);
    expect(compacted[0]).toEqual(route[0]);
    expect(compacted.at(-1)).toEqual(route.at(-1));
  });
});
