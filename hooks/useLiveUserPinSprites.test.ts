import { describe, expect, it } from 'vitest';
import { buildPinSpriteSignature, fillPinCaptureQueue } from './useLiveUserPinSprites';

describe('live user pin sprite cache', () => {
  it('does not regenerate a sprite when only viewer distance changes', () => {
    const base = {
      id: 7,
      username: 'Anna',
      avatarUrl: 'https://cdn.example/avatar.png',
      avatarFrameUrl: '',
      isPremium: false,
      isFriend: true,
      initials: 'AB',
    };
    expect(buildPinSpriteSignature({ ...base, distanceLabel: '0.1 km' }))
      .toBe(buildPinSpriteSignature({ ...base, distanceLabel: '9.9 km' }));
  });

  it('rebuilds a bitmap when online freshness status changes', () => {
    const base = {
      id: 8,
      username: 'Celina',
      avatarUrl: '',
      avatarFrameUrl: '',
      isPremium: false,
      isFriend: false,
      initials: 'CD',
      distanceLabel: 'LIVE',
    };
    expect(buildPinSpriteSignature({ ...base, stale: false }))
      .not.toBe(buildPinSpriteSignature({ ...base, stale: true }));
  });

  it('rebuilds a bitmap when the premium visual version changes', () => {
    const base = { id: 9, username: 'Vroom', avatarUrl: '', avatarFrameUrl: '', isPremium: true, isFriend: false, initials: 'VR', distanceLabel: 'LIVE' };
    expect(buildPinSpriteSignature({ ...base, visualVersion: 'v1' }))
      .not.toBe(buildPinSpriteSignature({ ...base, visualVersion: 'v2' }));
  });

  it('rebuilds a bitmap when the username shown inside the marker changes', () => {
    const base = { id: 10, avatarUrl: '', avatarFrameUrl: '', isPremium: false, isFriend: false, initials: 'AB', distanceLabel: 'LIVE' };
    expect(buildPinSpriteSignature({ ...base, username: 'Anna' }))
      .not.toBe(buildPinSpriteSignature({ ...base, username: 'Ania' }));
  });

  it('backfills the capture queue after the first four Android sprites finish', () => {
    const requests = ['1', '2', '3', '4', '5', '6'];
    expect(fillPinCaptureQueue(requests, [], [], 4)).toEqual(['1', '2', '3', '4']);
    expect(fillPinCaptureQueue(requests, ['1'], ['2', '3', '4'], 4))
      .toEqual(['2', '3', '4', '5']);
  });
});
