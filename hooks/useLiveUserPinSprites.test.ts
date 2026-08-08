import { describe, expect, it } from 'vitest';
import { buildPinSpriteSignature } from './useLiveUserPinSprites';

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
});
