import { describe, expect, it } from 'vitest';
import {
  createTripSessionLedger,
  markLedgerFinalizationPending,
  mergeForegroundLedgerSnapshot,
  mergeNativeLedgerSnapshot,
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
});
