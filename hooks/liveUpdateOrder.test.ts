import { describe, expect, it } from 'vitest';
import {
  isLiveServerEventFresh,
  isLiveUpdateNewer,
  resolveLiveUserLivenessAt,
} from './liveUpdateOrder';

describe('live update ordering', () => {
  it('rejects duplicates and older socket sequences', () => {
    expect(isLiveUpdateNewer({ previousSeq: 10, incomingSeq: 10 })).toBe(false);
    expect(isLiveUpdateNewer({ previousSeq: 10, incomingSeq: 9 })).toBe(false);
    expect(isLiveUpdateNewer({ previousSeq: 10, incomingSeq: 11 })).toBe(true);
  });

  it('uses server time for legacy payloads without a sequence', () => {
    expect(isLiveUpdateNewer({
      previousServerAt: 2000,
      incomingServerAt: 1999,
    })).toBe(false);
    expect(isLiveUpdateNewer({
      previousServerAt: 2000,
      incomingServerAt: 2001,
    })).toBe(true);
  });

  it('accepts the first known position', () => {
    expect(isLiveUpdateNewer({ incomingSeq: 1, incomingServerAt: 1000 })).toBe(true);
  });
});

describe('resolveLiveUserLivenessAt', () => {
  it('prefers local receipt time over a skewed remote fix clock', () => {
    expect(resolveLiveUserLivenessAt(10_000, 1_000)).toBe(10_000);
    expect(resolveLiveUserLivenessAt(10_000, 100_000)).toBe(10_000);
  });

  it('falls back to fix time when no receipt time exists', () => {
    expect(resolveLiveUserLivenessAt(null, 5_000)).toBe(5_000);
    expect(resolveLiveUserLivenessAt(null, null)).toBe(0);
  });
});

describe('isLiveServerEventFresh', () => {
  it('accepts legacy events without a server timestamp', () => {
    expect(isLiveServerEventFresh(null, 100_000)).toBe(true);
    expect(isLiveServerEventFresh(undefined, 100_000)).toBe(true);
  });

  it('rejects only an explicitly stale server timestamp', () => {
    expect(isLiveServerEventFresh(20_000, 100_000, 90_000)).toBe(true);
    expect(isLiveServerEventFresh(9_999, 100_000, 90_000)).toBe(false);
  });
});
