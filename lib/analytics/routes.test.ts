import { describe, expect, it } from 'vitest';
import { logicalScreenName } from './routes';

describe('logicalScreenName', () => {
  it('removes route groups and replaces numeric identifiers', () => {
    expect(logicalScreenName('/(tabs)/Community/meets/123')).toBe('community_meets_detail');
  });

  it('does not expose UUID identifiers in screen dimensions', () => {
    expect(logicalScreenName('/Community/vroomki/profile/123e4567-e89b-42d3-a456-426614174000'))
      .toBe('community_vroomki_profile_detail');
  });
});
