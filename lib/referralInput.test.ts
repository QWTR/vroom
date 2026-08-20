import { describe, expect, it } from 'vitest';
import { normalizeReferralInput } from './referralInput';

describe('normalizeReferralInput', () => {
  it('normalizes a plain code only after editing', () => {
    expect(normalizeReferralInput(' night1234 ')).toBe('NIGHT1234');
  });

  it('extracts a code from a referral query link', () => {
    expect(normalizeReferralInput('https://v-room.app/register?ref=Night1234')).toBe('NIGHT1234');
  });

  it('extracts a code from a path link', () => {
    expect(normalizeReferralInput('https://v-room.app/ref/Night1234')).toBe('NIGHT1234');
  });
});
