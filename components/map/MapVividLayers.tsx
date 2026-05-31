import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';

type Props = {
  enabled: boolean;
  isDark: boolean;
};

/**
 * Dodatkowe warstwy na composite — wzmocniona zieleń, tory, linie transit.
 * Działa na streets-v12 / navigation-night-v1 (standard), nie na sat/hybrid.
 */
export const MapVividLayers = memo(function MapVividLayers({ enabled, isDark }: Props) {
  if (!enabled) return null;

  const parkGreen   = isDark ? '#3f9e45' : '#72c85a';
  const grassGreen  = isDark ? '#4cae42' : '#8ed66a';
  const railColor   = isDark ? '#f0b429' : '#7a5238';
  const transitLine = isDark ? '#56c8f5' : '#1d6fd8';

  return (
    <Mapbox.VectorSource id="vroom-vivid-streets" url="mapbox://mapbox.mapbox-streets-v8">
      {/* Trawa / parki — pod drogami */}
      <Mapbox.FillLayer
        id="vroom-vivid-landcover-grass"
        sourceLayerID="landcover"
        filter={['==', ['get', 'class'], 'grass']}
        belowLayerID="road-path"
        style={{
          fillColor:     grassGreen,
          fillOpacity:   isDark ? 0.38 : 0.52,
        }}
      />
      <Mapbox.FillLayer
        id="vroom-vivid-landuse-park"
        sourceLayerID="landuse"
        filter={['match', ['get', 'class'],
          ['park', 'grass', 'pitch', 'garden', 'cemetery', 'forest', 'national_park'], true,
          false,
        ]}
        belowLayerID="road-path"
        style={{
          fillColor:     parkGreen,
          fillOpacity:   isDark ? 0.44 : 0.58,
        }}
      />

      {/* Tory — wyraźniejsze niż domyślne */}
      <Mapbox.LineLayer
        id="vroom-vivid-rail-major"
        sourceLayerID="road"
        filter={['==', ['get', 'class'], 'major_rail']}
        aboveLayerID="road-rail"
        style={{
          lineColor:   railColor,
          lineWidth:   isDark ? 3 : 2.8,
          lineOpacity: 0.95,
        }}
      />
      <Mapbox.LineLayer
        id="vroom-vivid-rail-minor"
        sourceLayerID="road"
        filter={['in', ['get', 'class'], ['literal', ['minor_rail', 'service_rail', 'narrow_gauge']]]}
        aboveLayerID="road-rail"
        style={{
          lineColor:   railColor,
          lineWidth:   isDark ? 2.2 : 2,
          lineOpacity: 0.88,
          lineDasharray: [1.2, 0.8],
        }}
      />

      {/* Linie transit (tram/bus corridors) */}
      <Mapbox.LineLayer
        id="vroom-vivid-transit"
        sourceLayerID="road"
        filter={['==', ['get', 'class'], 'transit']}
        style={{
          lineColor:     transitLine,
          lineWidth:     2,
          lineOpacity:   0.82,
          lineDasharray: [0.5, 0.25],
        }}
      />
    </Mapbox.VectorSource>
  );
});
