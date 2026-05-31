import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';

type Props = {
  enabled: boolean;
  showBuildings: boolean;
  isDark: boolean;
  minZoom: number;
};

/** DEM + niebo + opcjonalne 3D budynki. */
export const MapTerrainLayers = memo(function MapTerrainLayers({
  enabled,
  showBuildings,
  isDark,
  minZoom,
}: Props) {
  if (!enabled) return null;

  return (
    <>
      <Mapbox.RasterDemSource
        id="mapboxTerrainDem"
        url="mapbox://mapbox.mapbox-terrain-dem-v1"
        tileSize={512}
        maxZoomLevel={14}
      />
      <Mapbox.Terrain id="mapboxTerrain3d" sourceID="mapboxTerrainDem" style={{ exaggeration: 1.12 }} />
      <Mapbox.SkyLayer
        id="mapboxSkyAtmosphere"
        style={{
          skyType: 'atmosphere',
          skyAtmosphereSun: isDark ? [0.0, 90.0] : [180.0, 55.0],
          skyAtmosphereSunIntensity: isDark ? 10 : 18,
          skyAtmosphereColor: isDark ? '#1a2030' : '#c8dff5',
          skyAtmosphereHaloColor: isDark ? '#2a3550' : '#ffffff',
        }}
      />
      {showBuildings ? (
        <Mapbox.FillExtrusionLayer
          id="mapbox3dBuildings"
          sourceID="composite"
          sourceLayerID="building"
          filter={['==', ['get', 'extrude'], 'true']}
          minZoomLevel={minZoom}
          style={{
            fillExtrusionColor: isDark
              ? ['interpolate', ['linear'], ['get', 'height'], 0, '#3a3f52', 80, '#565d78', 200, '#6e7694']
              : ['interpolate', ['linear'], ['get', 'height'], 0, '#c4b5a0', 60, '#b8a690', 150, '#a8927a'],
            fillExtrusionOpacity: isDark ? 0.9 : 0.92,
            fillExtrusionHeight: ['coalesce', ['get', 'height'], 18],
            fillExtrusionBase: ['coalesce', ['get', 'min_height'], 0],
            fillExtrusionVerticalGradient: true,
          }}
        />
      ) : null}
    </>
  );
});
