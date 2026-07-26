import { describe, expect, it } from 'vitest';
import { isLiveUpdateNewer } from './liveUpdateOrder';

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
