import Mapbox from '@rnmapbox/maps';
import React, { memo, useCallback, useMemo } from 'react';
import type { FuelStation } from '../../hooks/useFuelStations';
import type { OfficialMapMeet } from '../../hooks/useOfficialMapMeets';
import type { PartnerPoi } from '../../hooks/usePartnerPois';
import { createMapPoiShape } from '../../lib/mapPoiPresentation';
import { MAP_POI_CARD_MIN_ZOOM, MAP_POI_MIN_ZOOM } from '../../lib/mapViewport';
import { MAP_POI_MARKER_IMAGES } from './mapMarkerSprites';

type Props = {
  stations: FuelStation[];
  partners: PartnerPoi[];
  meets: OfficialMapMeet[];
  preferredFuel?: string | null;
  onStationPress: (station: FuelStation) => void;
  onPartnerPress: (poi: PartnerPoi) => void;
  onMeetPress: (meet: OfficialMapMeet) => void;
};

export const MapPoiLayers = memo(function MapPoiLayers({
  stations,
  partners,
  meets,
  preferredFuel,
  onStationPress,
  onPartnerPress,
  onMeetPress,
}: Props) {
  const stationById = useMemo(() => new Map(stations.map((item) => [String(item.id), item])), [stations]);
  const partnerById = useMemo(() => new Map(partners.map((item) => [String(item.id), item])), [partners]);
  const meetById = useMemo(() => new Map(meets.map((item) => [String(item.id), item])), [meets]);
  const shape = useMemo(
    () => createMapPoiShape(stations, partners, meets, preferredFuel),
    [stations, partners, meets, preferredFuel],
  );

  const onPress = useCallback((event: any) => {
    const properties = event?.features?.[0]?.properties;
    const id = String(properties?.id ?? '');
    if (properties?.kind === 'fuel') {
      const item = stationById.get(id);
      if (item) onStationPress(item);
      return;
    }
    if (properties?.kind === 'partner') {
      const item = partnerById.get(id);
      if (item) onPartnerPress(item);
      return;
    }
    if (properties?.kind === 'meet') {
      const item = meetById.get(id);
      if (item) onMeetPress(item);
    }
  }, [stationById, partnerById, meetById, onStationPress, onPartnerPress, onMeetPress]);

  return (
    <>
      <Mapbox.Images images={MAP_POI_MARKER_IMAGES} />
      <Mapbox.ShapeSource
        id="viewportPoisSource"
        shape={shape as any}
        onPress={onPress}
        hitbox={{ width: 112, height: 76 }}
      >
        <Mapbox.SymbolLayer
          id="viewportPoiCompactPins"
          minZoomLevel={MAP_POI_MIN_ZOOM}
          maxZoomLevel={MAP_POI_CARD_MIN_ZOOM}
          style={{
            iconImage: ['get', 'compactImageKey'],
            iconSize: ['interpolate', ['linear'], ['zoom'], MAP_POI_MIN_ZOOM, 0.9, MAP_POI_CARD_MIN_ZOOM, 1],
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconOptional: false,
            iconPitchAlignment: 'viewport',
            iconRotationAlignment: 'viewport',
            iconAnchor: 'bottom',
            symbolSortKey: ['get', 'sortKey'],
          }}
        />

        <Mapbox.SymbolLayer
          id="viewportPoiCards"
          minZoomLevel={MAP_POI_CARD_MIN_ZOOM}
          style={{
            iconImage: ['get', 'cardImageKey'],
            iconSize: ['interpolate', ['linear'], ['zoom'], MAP_POI_CARD_MIN_ZOOM, 0.92, 17, 1.05],
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconOptional: false,
            iconPitchAlignment: 'viewport',
            iconRotationAlignment: 'viewport',
            iconAnchor: 'bottom',
            symbolSortKey: ['get', 'sortKey'],
          }}
        />

        <Mapbox.SymbolLayer
          id="viewportPoiCardTitles"
          minZoomLevel={MAP_POI_CARD_MIN_ZOOM}
          style={{
            textField: ['get', 'title'],
            textSize: 10.5,
            textColor: ['get', 'titleColor'],
            textHaloColor: '#070B10',
            textHaloWidth: 0.8,
            textOffset: [1.35, -3.95],
            textAnchor: 'center',
            textMaxWidth: 6,
            textLetterSpacing: 0.04,
            textAllowOverlap: true,
            textIgnorePlacement: true,
            textPitchAlignment: 'viewport',
            textRotationAlignment: 'viewport',
            symbolSortKey: ['get', 'sortKey'],
          }}
        />

        <Mapbox.SymbolLayer
          id="viewportPoiCardSubtitles"
          minZoomLevel={MAP_POI_CARD_MIN_ZOOM}
          style={{
            textField: ['get', 'subtitle'],
            textSize: 10.5,
            textColor: ['get', 'subtitleColor'],
            textHaloColor: '#070B10',
            textHaloWidth: 0.8,
            textOffset: [1.35, -2.45],
            textAnchor: 'center',
            textMaxWidth: 6,
            textAllowOverlap: true,
            textIgnorePlacement: true,
            textPitchAlignment: 'viewport',
            textRotationAlignment: 'viewport',
            symbolSortKey: ['get', 'sortKey'],
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
});
