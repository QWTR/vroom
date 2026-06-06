import { GpsBufferJitterFilter } from './gpsBufferJitterFilter';
import type { RawGpsFix } from './types';

describe('GpsBufferJitterFilter', () => {
  it('rejects points closer than jitter minimum', () => {
    const filter = new GpsBufferJitterFilter();
    const base: RawGpsFix = { lat: 52.1, lng: 21.0, accuracy: 8, timestamp: 1000 };
    expect(filter.accept(base)).toBe(true);
    expect(filter.accept({
      ...base,
      lat: 52.10001,
      lng: 21.00001,
      timestamp: 1100,
    })).toBe(false);
  });

  it('rejects impossible speed spikes', () => {
    const filter = new GpsBufferJitterFilter();
    expect(filter.accept({
      lat: 52.1,
      lng: 21.0,
      accuracy: 8,
      timestamp: 1000,
    })).toBe(true);
    expect(filter.accept({
      lat: 52.101,
      lng: 21.0,
      accuracy: 8,
      timestamp: 1050,
    })).toBe(false);
  });
});
