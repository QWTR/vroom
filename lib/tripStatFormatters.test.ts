import { describe, expect, it } from 'vitest';
import { formatDistanceKm, formatSpeedKmh, normalizeTripSpeed } from './tripStatFormatters';

describe('trip stat formatters', () => {
  it('rounds restored and live speeds to whole km/h', () => {
    expect(formatSpeedKmh(14.274062775442117)).toBe('14');
    expect(formatSpeedKmh(76.06799697875977)).toBe('76');
    expect(normalizeTripSpeed(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('keeps distance readable with one decimal place', () => {
    expect(formatDistanceKm(5.06)).toBe('5.1');
    expect(formatDistanceKm(Number.NaN)).toBe('0.0');
  });
});
