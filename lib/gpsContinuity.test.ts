import { describe, expect, it } from 'vitest';
import { evaluateGpsContinuityFix } from './gpsContinuity';

describe('GPS continuity after camera/process interruption', () => {
  it('uses two accurate fixes only as anchors before distance can continue', () => {
    const first = evaluateGpsContinuityFix(2, 52.1, 21.0, 12, 65);
    const second = evaluateGpsContinuityFix(first.remaining, 52.1001, 21.0001, 10, 65);
    const third = evaluateGpsContinuityFix(second.remaining, 52.1002, 21.0002, 10, 65);
    expect(first).toMatchObject({ action: 'reanchor', remaining: 1 });
    expect(second).toMatchObject({ action: 'reanchor', remaining: 0 });
    expect(third).toMatchObject({ action: 'continue', remaining: 0 });
  });

  it('does not consume a stale or inaccurate fix', () => {
    expect(evaluateGpsContinuityFix(2, 52.1, 21.0, 140, 65)).toMatchObject({
      action: 'reject', remaining: 2, reason: 'invalid_or_inaccurate_fix',
    });
  });
});
