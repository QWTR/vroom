import { describe, expect, it } from 'vitest';
import { formatWarningDistance, selectUpcomingWarning, warningHorizonMeters } from './warningAhead';
import type { LiveWarning } from './warningCatalog';

const warning = (id: number, lat: number, lng: number, direction: LiveWarning['direction'] = 'same'): LiveWarning => ({
  id,
  type: 'speed_control',
  direction,
  lat,
  lng,
  message: '',
  createdAt: new Date(0).toISOString(),
  expiresAt: new Date(60_000).toISOString(),
  confirmCount: 0,
  user: { id: 1, username: 'test', avatarUrl: null },
});

describe('upcoming warning selector', () => {
  it('uses a dynamic 2-5 km free-drive horizon', () => {
    expect(warningHorizonMeters(30)).toBe(2000);
    expect(warningHorizonMeters(70)).toBe(3500);
    expect(warningHorizonMeters(100)).toBe(5000);
  });

  it('selects events ahead and excludes events behind the driver', () => {
    const selected = selectUpcomingWarning({
      warnings: [warning(1, 52.01, 21), warning(2, 51.99, 21)],
      pose: { latitude: 52, longitude: 21, heading: 0, speedKmh: 70 },
      isNavigating: false,
      isDriving: true,
      route: [],
    });
    expect(selected?.warning.id).toBe(1);
  });

  it('excludes warnings explicitly assigned to the opposite direction', () => {
    const selected = selectUpcomingWarning({
      warnings: [warning(1, 52.005, 21, 'opposite')],
      pose: { latitude: 52, longitude: 21, heading: 0, speedKmh: 50 },
      isNavigating: false,
      isDriving: true,
      route: [],
    });
    expect(selected).toBeNull();
  });

  it('counts additional relevant events ahead', () => {
    const selected = selectUpcomingWarning({
      warnings: [warning(1, 52.003, 21), warning(2, 52.006, 21), warning(3, 52.009, 21)],
      pose: { latitude: 52, longitude: 21, heading: 0, speedKmh: 90 },
      isNavigating: false,
      isDriving: true,
      route: [],
    });
    expect(selected?.warning.id).toBe(1);
    expect(selected?.additionalCount).toBe(2);
  });

  it('formats metres and kilometres without losing precision', () => {
    expect(formatWarningDistance(480)).toBe('480 m');
    expect(formatWarningDistance(1450)).toBe('1.4 km');
  });
});
