import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const poiLayer = readFileSync(resolve('components/map/MapPoiLayers.tsx'), 'utf8');
const cameraLayer = readFileSync(resolve('components/map/SpeedCameraMapLayers.tsx'), 'utf8');
const dropLayer = readFileSync(resolve('components/map/GeoDropMapLayer.tsx'), 'utf8');
const mapScreen = readFileSync(resolve('app/(tabs)/map.tsx'), 'utf8');

describe('map marker rendering contract', () => {
  it('uses native image registries without runtime React image capture or fallback circles', () => {
    expect(poiLayer).toContain('<Mapbox.Images images={MAP_POI_MARKER_IMAGES} />');
    expect(poiLayer).not.toMatch(/<Mapbox\.Image(?:\s|>)/);
    expect(poiLayer).not.toContain('CircleLayer');
    expect(cameraLayer).not.toMatch(/<Mapbox\.Image(?:\s|>)/);
    expect(dropLayer).not.toMatch(/<Mapbox\.Image(?:\s|>)/);
    expect(poiLayer).not.toContain('features.length === 0');
  });

  it('keeps every feature separate and never enables clustering or counters', () => {
    for (const source of [poiLayer, cameraLayer, dropLayer]) {
      expect(source).not.toMatch(/\bcluster\s*=/);
      expect(source).not.toContain('clusterRadius');
      expect(source).not.toContain('point_count');
    }
    expect(poiLayer).toContain('iconAllowOverlap: true');
    expect(poiLayer).toContain('iconIgnorePlacement: true');
  });

  it('switches from compact pins to cards at the shared zoom boundary', () => {
    expect(poiLayer).toContain('maxZoomLevel={MAP_POI_CARD_MIN_ZOOM}');
    expect(poiLayer).toContain('minZoomLevel={MAP_POI_CARD_MIN_ZOOM}');
  });

  it('raises FPS once when interaction begins and resets it on map idle', () => {
    expect(mapScreen).toContain('if (mapGestureActiveRef.current) return;');
    expect(mapScreen).toContain('interacting: true');
    expect(mapScreen).toContain('onTouchStart={markMapInteractionStartedForFps}');
    expect(mapScreen).toContain('markMapIdleForFps();');
  });
});
