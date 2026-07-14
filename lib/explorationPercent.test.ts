import { describe, expect, it } from 'vitest';
import { formatExplorationPercent } from './explorationPercent';

describe('exploration percent', () => {
  it('shows discovered cells below one percent as <1%', () => {
    expect(formatExplorationPercent(46, 0.02)).toBe('<1%');
  });

  it('shows zero when no cells were discovered', () => {
    expect(formatExplorationPercent(0, 0)).toBe('0%');
  });
});
