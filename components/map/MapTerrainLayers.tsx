import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';

type Props = {
  enabled: boolean;
  showBuildings: boolean;
  isDark: boolean;
  minZoom: number;
};

/** DEM + 3D buildings — mount only when needed to limit tile fetches. */
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
      <Mapbox.Terrain id="mapboxTerrain3d" sourceID="mapboxTerrainDem" style={{ exaggeration: 1.15 }} />
      <Mapbox.SkyLayer
        id="mapboxSkyAtmosphere"
        style={{
          skyType: 'atmosphere',
          skyAtmosphereSun: [0.0, 90.0],
          skyAtmosphereSunIntensity: 12,
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
            fillExtrusionColor: isDark ? '#2f2f35' : '#d6d8de',
            fillExtrusionOpacity: 0.88,
            fillExtrusionHeight: ['coalesce', ['get', 'height'], 18],
            fillExtrusionBase: ['coalesce', ['get', 'min_height'], 0],
            fillExtrusionVerticalGradient: true,
          }}
        />
      ) : null}
    </>
  );
});
