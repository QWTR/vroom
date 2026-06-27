import { describe, expect, it } from 'vitest';
import { resolveOnlineCountPayload } from './appPresencePayload';

describe('appPresencePayload', () => {
  it('prefers online over activeInApp', () => {
    expect(resolveOnlineCountPayload({ online: 50, activeInApp: 6 })).toBe(50);
  });

  it('falls back to activeInApp for older API payloads', () => {
    expect(resolveOnlineCountPayload({ activeInApp: 6 })).toBe(6);
  });

  it('rejects invalid counts', () => {
    expect(resolveOnlineCountPayload({ online: 'nope', activeInApp: null })).toBeNull();
  });
});
