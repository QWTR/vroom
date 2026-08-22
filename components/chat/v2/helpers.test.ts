import { describe, expect, it } from 'vitest';
import { formatChatTime } from './helpers';

describe('formatChatTime', () => {
  it('shows the exact calendar date and time for every chat message', () => {
    expect(formatChatTime('2026-08-22T14:37:00')).toBe('22.08.2026, 14:37');
  });

  it('does not render invalid timestamps', () => {
    expect(formatChatTime('invalid-date')).toBe('');
  });
});
