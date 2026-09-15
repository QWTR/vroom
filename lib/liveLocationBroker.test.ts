import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api/client', () => ({ apiRequest: vi.fn(async () => ({ ok: true })) }));

import { prepareLiveLocationPacket, resetLiveLocationBroker, sendLiveLocation } from './liveLocationBroker';
import { apiRequest } from './api/client';

describe('live location broker heartbeat', () => {
  afterEach(() => {
    resetLiveLocationBroker();
    vi.clearAllMocks();
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

  it('waits for its own queued sharing command and preserves it between GPS packets', async () => {
    let release!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = sendLiveLocation({ lat: 52, lng: 21 }, { force: true });
    let offResolved = false;
    const off = sendLiveLocation({ shareLocation: false }, { force: true }).then(() => { offResolved = true; });
    const gps = sendLiveLocation({ lat: 53, lng: 21 }, { force: true });
    const on = sendLiveLocation({ shareLocation: true }, { force: true });
    await Promise.resolve();
    expect(offResolved).toBe(false);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    release({ accepted: true });
    await Promise.all([first, off, gps, on]);
    const packets = vi.mocked(apiRequest).mock.calls.map(([, options]) => options?.body as any);
    expect(packets.map((packet) => packet.shareLocation)).toEqual([undefined, false, undefined, true]);
    expect(offResolved).toBe(true);
  });

  it('does not report an earlier request failure as the result of a later successful enable', async () => {
    let rejectFirst!: (error: Error) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const first = sendLiveLocation({ lat: 52, lng: 21 }, { force: true });
    const failed = expect(first).rejects.toThrow('offline');
    const enable = sendLiveLocation({ shareLocation: true }, { force: true });
    rejectFirst(new Error('offline'));
    await failed;
    await expect(enable).resolves.toEqual({ ok: true });
  });
});
