import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api/client', () => ({ apiRequest: vi.fn(async () => ({ ok: true })) }));

import { prepareLiveLocationPacket, resetLiveLocationBroker } from './liveLocationBroker';

describe('live location broker heartbeat', () => {
  afterEach(() => {
    resetLiveLocationBroker();
    vi.useRealTimers();
  });

  it('sends a stationary duplicate fix often enough to keep LIVE presence alive', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T10:00:00.000Z'));
    const packet = { lat: 52, lng: 21, fixId: 'same-fix', fixAt: Date.now(), speedMps: 0 };

    expect(prepareLiveLocationPacket(packet)).not.toBeNull();
    vi.advanceTimersByTime(20_000);
    expect(prepareLiveLocationPacket(packet)).toBeNull();
    vi.advanceTimersByTime(5_000);
    expect(prepareLiveLocationPacket(packet)).not.toBeNull();
  });
});
