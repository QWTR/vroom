import { describe, expect, it } from 'vitest';
import {
  highwaySpeedFallback,
  parseOsmMaxSpeed,
  resolveOsmSpeedLimit,
  sanitizeDisplaySpeedLimit,
} from './osmMaxSpeed';

describe('parseOsmMaxSpeed', () => {
  it('parses plain numbers and units', () => {
    expect(parseOsmMaxSpeed('50').kmh).toBe(50);
    expect(parseOsmMaxSpeed('80 km/h').kmh).toBe(80);
    expect(parseOsmMaxSpeed('80km/h').kmh).toBe(80);
  });

  it('parses PL zone tags', () => {
    expect(parseOsmMaxSpeed('PL:urban').kmh).toBe(50);
    expect(parseOsmMaxSpeed('pl:rural').kmh).toBe(90);
    expect(parseOsmMaxSpeed('PL:motorway').kmh).toBe(140);
  });

  it('handles none as unlimited without numeric value', () => {
    const r = parseOsmMaxSpeed('none');
    expect(r.kmh).toBeNull();
    expect(r.unlimited).toBe(true);
  });

  it('converts mph', () => {
    expect(parseOsmMaxSpeed('30 mph').kmh).toBe(48);
  });
});

describe('highwaySpeedFallback', () => {
  it('maps motorway and expressway', () => {
    expect(highwaySpeedFallback('motorway')).toBe(140);
    expect(highwaySpeedFallback('expressway')).toBe(120);
    expect(highwaySpeedFallback('residential')).toBe(30);
    expect(highwaySpeedFallback('living_street')).toBe(20);
  });
});

describe('resolveOsmSpeedLimit', () => {
  it('prefers maxspeed over highway', () => {
    expect(resolveOsmSpeedLimit('60', 'motorway')).toBe(60);
  });

  it('falls back to highway when maxspeed missing', () => {
    expect(resolveOsmSpeedLimit(undefined, 'motorway')).toBe(140);
    expect(resolveOsmSpeedLimit('', 'expressway')).toBe(120);
  });

  it('uses highway for unlimited on motorway', () => {
    expect(resolveOsmSpeedLimit('none', 'motorway')).toBe(140);
  });
});

describe('sanitizeDisplaySpeedLimit', () => {
  it('rejects invalid display values', () => {
    expect(sanitizeDisplaySpeedLimit(NaN)).toBeNull();
    expect(sanitizeDisplaySpeedLimit(0)).toBeNull();
    expect(sanitizeDisplaySpeedLimit(50)).toBe(50);
  });
});
