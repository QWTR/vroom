import { describe, expect, it } from 'vitest';
import { buildPinSpriteSignature, fillPinCaptureQueue } from './useLiveUserPinSprites';

describe('live user pin sprite cache', () => {
  it('does not regenerate a sprite when only viewer distance changes', () => {
    const base = {
      id: 7,
      avatarUrl: 'https://cdn.example/avatar.png',
      avatarFrameUrl: '',
      isPremium: false,
      isFriend: true,
      initials: 'AB',
    };
    expect(buildPinSpriteSignature({ ...base, distanceLabel: '0.1 km' }))
      .toBe(buildPinSpriteSignature({ ...base, distanceLabel: '9.9 km' }));
  });

  it('does not rebuild a bitmap when freshness changes', () => {
    const base = {
      id: 8,
      avatarUrl: '',
      avatarFrameUrl: '',
      isPremium: false,
      isFriend: false,
      initials: 'CD',
      distanceLabel: 'LIVE',
    };
    expect(buildPinSpriteSignature({ ...base, stale: false }))
      .toBe(buildPinSpriteSignature({ ...base, stale: true }));
  });

  it('backfills the capture queue after the first four Android sprites finish', () => {
    const requests = ['1', '2', '3', '4', '5', '6'];
    expect(fillPinCaptureQueue(requests, [], [], 4)).toEqual(['1', '2', '3', '4']);
    expect(fillPinCaptureQueue(requests, ['1'], ['2', '3', '4'], 4))
      .toEqual(['2', '3', '4', '5']);
  });
});
