import {
  GATE_ACC_FULL_M,
  GpsQualityGate,
} from './gpsQualityGate';

describe('GpsQualityGate', () => {
  it('rejects fix with accuracy above degraded max', () => {
    const gate = new GpsQualityGate();
    const r = gate.evaluate(
      { lat: 52, lng: 19, accuracy: 60, timestamp: 1000 },
      { isMoving: true, isNavigating: false, lastSpeedKmh: 50 },
    );
    expect(r.verdict).toBe('REJECT');
  });

  it('degrades fix with accuracy between full and degraded max', () => {
    const gate = new GpsQualityGate();
    const r = gate.evaluate(
      { lat: 52, lng: 19, accuracy: 40, timestamp: 1000 },
      { isMoving: true, isNavigating: false, lastSpeedKmh: 50 },
    );
    expect(r.verdict).toBe('DEGRADED');
    expect(r.allowSpeedDelta).toBe(false);
  });

  it('rejects hard kinematic jump after accepted fix', () => {
    const gate = new GpsQualityGate();
    gate.commitAccepted({
      lat: 52,
      lng: 19,
      accuracy: 10,
      timestamp: 1000,
    });
    const r = gate.evaluate(
      { lat: 52.0005, lng: 19, accuracy: 10, timestamp: 1500 },
      { isMoving: true, isNavigating: false, lastSpeedKmh: 30 },
    );
    expect(r.verdict).toBe('REJECT');
  });

  it('full accept for small step at highway speed', () => {
    const gate = new GpsQualityGate();
    gate.commitAccepted({
      lat: 52,
      lng: 19,
      accuracy: 8,
      timestamp: 1000,
    });
    const r = gate.evaluate(
      { lat: 52.00008, lng: 19, accuracy: GATE_ACC_FULL_M, timestamp: 2000 },
      { isMoving: true, isNavigating: false, lastSpeedKmh: 90 },
    );
    expect(r.verdict).toBe('FULL_ACCEPT');
    expect(r.allowSpeedDelta).toBe(true);
  });

  it('requires two wake samples before registerWakeSample returns true', () => {
    const gate = new GpsQualityGate();
    const fix = {
      lat: 52,
      lng: 19,
      accuracy: 10,
      timestamp: 1000,
      gpsSpeedMs: 1.5,
    };
    expect(gate.registerWakeSample(fix, 'FULL_ACCEPT')).toBe(false);
    expect(gate.registerWakeSample(fix, 'FULL_ACCEPT')).toBe(true);
  });

  it('wake doppler works on DEGRADED fix (acc 40m)', () => {
    const gate = new GpsQualityGate();
    const fix = {
      lat: 52,
      lng: 19,
      accuracy: 40,
      timestamp: 1000,
      gpsSpeedMs: 2,
    };
    expect(gate.registerWakeSample(fix, 'DEGRADED')).toBe(false);
    expect(gate.registerWakeSample(fix, 'DEGRADED')).toBe(true);
    expect(gate.registerWakeSample(fix, 'REJECT')).toBe(false);
  });

  it('resets envelope after three consecutive bad verdicts while driving', () => {
    const gate = new GpsQualityGate();
    const fix = {
      lat: 52,
      lng: 19,
      accuracy: 40,
      timestamp: 1000,
      gpsSpeedMs: 2,
    };
    const ctx = { isMoving: true, isNavigating: false, lastSpeedKmh: 50 };
    expect(gate.registerBadVerdict('DEGRADED', true)).toBe(false);
    expect(gate.registerBadVerdict('REJECT', true)).toBe(false);
    expect(gate.registerBadVerdict('DEGRADED', true)).toBe(true);
    gate.commitAccepted({ ...fix, lat: 52.0001, timestamp: 2000 });
    gate.commitAccepted({
      lat: 52.00008,
      lng: 19,
      accuracy: 10,
      timestamp: 2500,
    });
    const r = gate.evaluate(
      { lat: 52.00016, lng: 19, accuracy: 10, timestamp: 3000 },
      ctx,
    );
    expect(r.verdict).not.toBe('REJECT');
  });

  it('stop FULL_ACCEPT up to 35m accuracy', () => {
    const gate = new GpsQualityGate();
    const r = gate.evaluate(
      { lat: 52, lng: 19, accuracy: 32, timestamp: 1000 },
      { isMoving: false, isNavigating: false, lastSpeedKmh: 0 },
    );
    expect(r.verdict).toBe('FULL_ACCEPT');
  });
});
