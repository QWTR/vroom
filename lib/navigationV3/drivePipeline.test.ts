import { describe, expect, it } from 'vitest';
import { createDrivePipeline } from './drivePipeline';
import { makeRoadPolyline } from './snapEngine';

const BASE_TS = 1_700_000_000_000;

function gpsFix(
  lat: number,
  lng: number,
  tsOffset = 0,
  extras: Partial<{
    accuracyM: number;
    speedMs: number;
    headingDeg: number;
  }> = {},
) {
  return {
    lat,
    lng,
    accuracyM: extras.accuracyM ?? 8,
    timestampMs: BASE_TS + tsOffset,
    speedMs: extras.speedMs ?? 8,
    headingDeg: extras.headingDeg ?? 90,
  };
}

describe('createDrivePipeline', () => {
  it('returns null in idle mode', () => {
    const pipeline = createDrivePipeline();
    pipeline.setMode('idle');
    expect(pipeline.processGpsFix(gpsFix(52.1, 21.0))).toBeNull();
  });

  it('accepts first fix and produces NavigationTarget', () => {
    const pipeline = createDrivePipeline();
    pipeline.setMode('freeDrive');
    const out = pipeline.processGpsFix(gpsFix(52.2297, 21.0122));
    expect(out).not.toBeNull();
    expect(out!.rejected).toBe(false);
    expect(out!.target.allowInstant).toBe(true);
    expect(out!.target.lat).toBeCloseTo(52.2297, 4);
    expect(out!.target.lng).toBeCloseTo(21.0122, 4);
  });

  it('rejects impossible GPS teleport', () => {
    const pipeline = createDrivePipeline();
    pipeline.setMode('freeDrive');
    pipeline.processGpsFix(gpsFix(52.2297, 21.0122, 0));
    const out = pipeline.processGpsFix(
      gpsFix(52.5, 21.5, 1000, { speedMs: 0 }),
    );
    expect(out).not.toBeNull();
    expect(out!.rejected).toBe(true);
    expect(out!.rejectReason).toBe('impossible_jump');
  });

  it('snaps to road polyline in freeDrive', () => {
    const pipeline = createDrivePipeline();
    pipeline.setMode('freeDrive');
    const road = makeRoadPolyline('main', [
      { lat: 52.2297, lng: 21.0122 },
      { lat: 52.2307, lng: 21.0122 },
    ]);
    pipeline.setRoadPolylines(road ? [road] : []);

    const out = pipeline.processGpsFix(
      gpsFix(52.22975, 21.01225, 0, { speedMs: 10, headingDeg: 0 }),
    );
    expect(out!.rejected).toBe(false);
    expect(out!.snap.pathMode).toBe('onRoad');
    expect(out!.target.roadBlend).toBeGreaterThan(0);
  });

  it('keeps freeDrive heading from raw GPS course even when position snaps to road', () => {
    const pipeline = createDrivePipeline();
    pipeline.setMode('freeDrive');
    const diagonalRoad = makeRoadPolyline('diagonal-road', [
      { lat: 52.2297, lng: 21.0122 },
      { lat: 52.2302, lng: 21.0140 },
    ]);
    pipeline.setRoadPolylines(diagonalRoad ? [diagonalRoad] : []);

    pipeline.processGpsFix(gpsFix(52.2298, 21.0122, 0, { speedMs: 12, headingDeg: 0 }));
    const out = pipeline.processGpsFix(
      gpsFix(52.2298, 21.01238, 1000, { speedMs: 12, headingDeg: 0 }),
    );

    expect(out!.rejected).toBe(false);
    expect(out!.snap.pathMode).toBe('onRoad');
    expect(out!.target.headingSource).toBe('cog');
    expect(out!.target.headingDeg).toBeGreaterThan(80);
    expect(out!.target.headingDeg).toBeLessThan(100);
  });

  it('uses route polyline in navigation mode', () => {
    const pipeline = createDrivePipeline();
    pipeline.setMode('navigation');
    pipeline.setRoutePolyline([
      { lat: 52.2297, lng: 21.0122 },
      { lat: 52.2317, lng: 21.0122 },
    ]);
    const out = pipeline.processGpsFix(
      gpsFix(52.2298, 21.0122, 0, { speedMs: 12, headingDeg: 0 }),
    );
    expect(out!.rejected).toBe(false);
    expect(out!.snap.polylineKey).toBe('route');
  });

  it('detaches from an old route after two fixes proving a real turn', () => {
    const pipeline = createDrivePipeline();
    pipeline.setMode('navigation');
    pipeline.setRoutePolyline([
      { lat: 52.2297, lng: 21.0122 },
      { lat: 52.2327, lng: 21.0122 },
    ]);
    const eastRoad = makeRoadPolyline('actual_east', [
      { lat: 52.2298, lng: 21.0122 },
      { lat: 52.2298, lng: 21.0182 },
    ]);
    pipeline.setRoadPolylines(eastRoad ? [eastRoad] : []);

    pipeline.processGpsFix(gpsFix(52.2298, 21.01225, 0, { speedMs: 12, headingDeg: 90 }));
    const second = pipeline.processGpsFix(
      gpsFix(52.2298, 21.01242, 1000, { speedMs: 12, headingDeg: 90 }),
    );

    expect(second!.rejected).toBe(false);
    expect(second!.snap.polylineKey).not.toBe('route');
  });
});
