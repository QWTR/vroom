import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/map/LiveUsersFleetLayer.tsx'), 'utf8');
const controllerSource = readFileSync(
  resolve(process.cwd(), 'components/map/LiveFleetMapController.tsx'),
  'utf8',
);

describe('LIVE fleet layer contract', () => {
  it('renders every user individually without clustering or counters', () => {
    expect(source).not.toContain('cluster={');
    expect(source).not.toContain('clusterProperties');
    expect(source).not.toContain('point_count');
  });

  it('uses overview dots and detailed avatar markers at the zoom boundary', () => {
    expect(source).toContain('liveFleetHotOverview');
    expect(source).toContain('liveFleetColdOverview');
    expect(source).toContain('maxZoomLevel={MAP_LIVE_DETAIL_MIN_ZOOM}');
    expect(source).toContain('minZoomLevel={MAP_LIVE_DETAIL_MIN_ZOOM}');
    expect(source).toContain('detailed ? metaPinRequests : []');
  });

  it('does not hide received users while native viewport bounds are unavailable', () => {
    expect(controllerSource).toContain('LIVE_FLEET_FALLBACK_VIEWPORT');
    expect(controllerSource).toContain('const renderEnabled = enabled;');
    expect(controllerSource).not.toContain('enabled && viewportReady');
  });
});
