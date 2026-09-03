import Mapbox from '@rnmapbox/maps';
import React, { memo, useCallback, useMemo } from 'react';
import { MAP_LAYER_IDS } from '../../lib/mapScreen/mapLayerContract';
import { WARNING_CATALOG, type LiveWarning } from '../../lib/warnings/warningCatalog';
import { MAP_POI_MIN_ZOOM } from '../../lib/mapViewport';

type WarningMapLayersProps = {
  warnings: LiveWarning[];
  onSelectWarning: (warning: LiveWarning) => void;
};

export const WarningMapLayers = memo(function WarningMapLayers({
  warnings,
  onSelectWarning,
}: WarningMapLayersProps) {
  const { shape, byId } = useMemo(() => {
    const warningById = new Map<number, LiveWarning>();
    const features = warnings.flatMap((warning) => {
      const lat = Number(warning.lat);
      const lng = Number(warning.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      warningById.set(warning.id, warning);
      const meta = WARNING_CATALOG[warning.type] ?? WARNING_CATALOG.kosmici;
      return [{
        type: 'Feature' as const,
        id: warning.id,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: {
          warningId: warning.id,
          color: meta.color,
          glyph: meta.glyph,
          countLabel: warning.confirmCount > 0 ? `+${warning.confirmCount}` : '',
        },
      }];
    });

    return {
      byId: warningById,
      shape: { type: 'FeatureCollection' as const, features },
    };
  }, [warnings]);

  const handlePress = useCallback((event: any) => {
    const rawId = event.features?.[0]?.properties?.warningId;
    const warning = byId.get(Number(rawId));
    if (warning) onSelectWarning(warning);
  }, [byId, onSelectWarning]);

  return (
    <Mapbox.ShapeSource
      id="liveWarningSource"
      shape={shape}
      onPress={handlePress}
      hitbox={{ width: 48, height: 48 }}
    >
      <Mapbox.CircleLayer
        id={MAP_LAYER_IDS.warningHalo}
        minZoomLevel={MAP_POI_MIN_ZOOM}
        aboveLayerID={MAP_LAYER_IDS.routeMain}
        style={{
          circleRadius: 24,
          circleColor: ['get', 'color'],
          circleOpacity: 0.28,
          circleStrokeWidth: 5,
          circleStrokeColor: '#ffffff',
          circleStrokeOpacity: 0.98,
          circlePitchAlignment: 'viewport',
        }}
      />
      <Mapbox.SymbolLayer
        id={MAP_LAYER_IDS.warningIcon}
        minZoomLevel={MAP_POI_MIN_ZOOM}
        aboveLayerID={MAP_LAYER_IDS.warningHalo}
        style={{
          textField: ['get', 'glyph'],
          textSize: 21,
          textColor: '#ffffff',
          textHaloColor: '#10141b',
          textHaloWidth: 2,
          textAllowOverlap: true,
          textIgnorePlacement: true,
          textPitchAlignment: 'viewport',
          textRotationAlignment: 'viewport',
        }}
      />
      <Mapbox.SymbolLayer
        id={MAP_LAYER_IDS.warningCount}
        minZoomLevel={MAP_POI_MIN_ZOOM}
        aboveLayerID={MAP_LAYER_IDS.warningIcon}
        style={{
          textField: ['get', 'countLabel'],
          textSize: 11,
          textColor: '#ffffff',
          textHaloColor: '#10141b',
          textHaloWidth: 2,
          textOffset: [1.65, -1.65],
          textAllowOverlap: true,
          textIgnorePlacement: true,
          textPitchAlignment: 'viewport',
        }}
      />
    </Mapbox.ShapeSource>
  );
});
