import { describe, expect, it } from 'vitest';
import {
  enqueueTripFinalization,
  parseTripFinalizationOutbox,
  removeTripFinalization,
  serializeTripFinalizationOutbox,
} from './tripFinalizationOutbox';

const first = {
  tripSessionId: 'trip_cancelled_at_0_2km',
  payload: { distance: 0.2, routePoints: [{ latitude: 52, longitude: 21 }] },
  createdAt: 1,
};

const second = {
  tripSessionId: 'trip_finished_offline_after_restart',
  payload: { distance: 2, routePoints: [] },
  createdAt: 2,
};

describe('trip finalization outbox', () => {
  it('migrates the old one-item outbox without losing that history', () => {
    expect(parseTripFinalizationOutbox(JSON.stringify(first))).toEqual([first]);
  });

  it('keeps two offline sessions and removes only the server-confirmed one', () => {
    const queued = enqueueTripFinalization(
      enqueueTripFinalization([], first),
      second,
    );
    const restored = parseTripFinalizationOutbox(serializeTripFinalizationOutbox(queued));

    expect(restored.map((item) => item.tripSessionId)).toEqual([
      first.tripSessionId,
      second.tripSessionId,
    ]);
    expect(removeTripFinalization(restored, first.tripSessionId)).toEqual([second]);
  });

  it('replaces a retry for the same trip instead of creating duplicate history', () => {
    const retry = { ...first, payload: { distance: 2.1 }, createdAt: 3 };
    const queued = enqueueTripFinalization([first, second], retry);

    expect(queued).toEqual([second, retry]);
  });
});
