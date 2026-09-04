import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatLiveMarkerUsername, liveUserMarkerMetrics } from '../../lib/liveUserMarkerUi';

const layerSource = readFileSync(resolve(process.cwd(), 'components/map/LiveUsersFleetLayer.tsx'), 'utf8');
const markerSource = readFileSync(resolve(process.cwd(), 'components/map/LiveUserMapMarker.tsx'), 'utf8');
const controllerSource = readFileSync(
  resolve(process.cwd(), 'components/map/LiveFleetMapController.tsx'),
  'utf8',
);
const liveMapSource = readFileSync(resolve(process.cwd(), 'hooks/useLiveMap.ts'), 'utf8');

describe('LIVE native marker contract', () => {
  it('renders real MarkerView UI without bitmap capture or map symbol sprites', () => {
    expect(layerSource).not.toContain('CircleLayer');
    expect(layerSource).not.toContain('SymbolLayer');
    expect(layerSource).not.toContain('ShapeSource');
    expect(layerSource).not.toContain('useLiveUserPinSprites');
    expect(markerSource).toContain('<Mapbox.MarkerView');
    expect(markerSource).not.toContain('ViewShot');
  });

  it('keeps the marker compact at country and street zoom', () => {
    expect(liveUserMarkerMetrics(3).avatar).toBe(34);
    expect(liveUserMarkerMetrics(3).labelWidth).toBe(72);
    expect(liveUserMarkerMetrics(18).avatar).toBe(42);
    expect(liveUserMarkerMetrics(18).labelWidth).toBe(88);
    expect(markerSource).toContain('minWidth: 48');
    expect(markerSource).toContain('minHeight: 48');
  });

  it('shows avatar above identity, Premium status and Nitro avatar decoration', () => {
    expect(markerSource.indexOf('styles.avatarStage')).toBeLessThan(markerSource.indexOf('styles.label'));
    expect(markerSource).toContain("premium ? 'PREMIUM · LIVE' : 'LIVE'");
    expect(markerSource).toContain('<ShopAvatarDecoration item={frameItem}');
    expect(markerSource).toContain('cachePolicy="memory-disk"');
  });

  it('truncates long names without growing the marker', () => {
    expect(formatLiveMarkerUsername('123456789012345')).toBe('123456789012345');
    expect(formatLiveMarkerUsername('1234567890123456')).toBe('12345678901234…');
  });

  it('keeps stale users visible and culls only outside the expanded viewport', () => {
    expect(markerSource).toContain('stale && styles.stale');
    expect(controllerSource).toContain('expandBoundsByMeters(effectiveViewportBounds, 1_500)');
    expect(controllerSource).toContain('visibleMarkerIds');
    expect(controllerSource).toContain('LIVE_FLEET_FALLBACK_VIEWPORT');
  });

  it('updates identity metadata without replacing marker coordinates', () => {
    expect(liveMapSource).toContain("socket.on('live:user:identity'");
    expect(liveMapSource).toContain('store.setMeta({');
    expect(liveMapSource).toContain('store.setPosition(id, existingPos.lat, existingPos.lng, true)');
  });
});
