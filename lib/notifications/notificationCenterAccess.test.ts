import { describe, expect, it, vi } from 'vitest';
import {
  allowNotificationCenterEntry,
  consumeNotificationCenterEntry,
} from './notificationCenterAccess';

describe('notification center entry guard', () => {
  it('allows one explicit navigation only', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    allowNotificationCenterEntry();
    expect(consumeNotificationCenterEntry(1_500)).toBe(true);
    expect(consumeNotificationCenterEntry(1_501)).toBe(false);
    vi.restoreAllMocks();
  });

  it('rejects restored and expired routes', () => {
    expect(consumeNotificationCenterEntry(20_000)).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(30_000);
    allowNotificationCenterEntry(1_000);
    expect(consumeNotificationCenterEntry(31_001)).toBe(false);
    vi.restoreAllMocks();
  });
});
