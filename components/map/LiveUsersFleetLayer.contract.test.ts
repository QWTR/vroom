import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/map/LiveUsersFleetLayer.tsx'), 'utf8');
const controllerSource = readFileSync(
  resolve(process.cwd(), 'components/map/LiveFleetMapController.tsx'),
  'utf8',
);
const liveMapSource = readFileSync(resolve(process.cwd(), 'hooks/useLiveMap.ts'), 'utf8');

describe('LIVE fleet layer contract', () => {
  it('renders every user individually without clustering or counters', () => {
    expect(source).not.toContain('cluster={');
    expect(source).not.toContain('clusterProperties');
    expect(source).not.toContain('point_count');
  });

  it('uses the same identity marker at every zoom without overview dots', () => {
    expect(source).not.toContain('CircleLayer');
    expect(source).not.toContain('MAP_LIVE_DETAIL_MIN_ZOOM');
    expect(controllerSource).not.toContain('MAP_LIVE_DETAIL_MIN_ZOOM');
    expect(source).toContain('useLiveUserPinSprites(metaPinRequests)');
    expect(source).toContain('<Mapbox.SymbolLayer id="liveFleetHotPins" style={pinStyle as any} />');
    expect(source).toContain('<Mapbox.SymbolLayer id="liveFleetColdPins" style={pinStyle as any} />');
  });

  it('scales one marker smoothly and preserves overlap and tap area', () => {
    expect(source).toContain('0, 0.72');
    expect(source).toContain('5, 0.78');
    expect(source).toContain('11.5, 0.88');
    expect(source).toContain('15.5, 0.98');
    expect(source).toContain('18, 1.04');
    expect(source).toContain('iconAllowOverlap: true');
    expect(source).toContain('hitbox={{ width: 160, height: 64 }}');
  });

  it('does not hide received users while native viewport bounds are unavailable', () => {
    expect(controllerSource).toContain('LIVE_FLEET_FALLBACK_VIEWPORT');
    expect(controllerSource).toContain('const renderEnabled = enabled;');
    expect(controllerSource).not.toContain('enabled && viewportReady');
  });

  it('updates identity metadata without replacing marker coordinates', () => {
    expect(liveMapSource).toContain("socket.on('live:user:identity'");
    expect(liveMapSource).toContain('store.setMeta({');
    expect(liveMapSource).toContain('store.setPosition(id, existingPos.lat, existingPos.lng, true)');
  });
});
