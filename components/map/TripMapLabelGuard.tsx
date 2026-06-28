import { useEffect } from 'react';
import type { RefObject } from 'react';
import Mapbox from '@rnmapbox/maps';

/**
 * Ukrywa tarcze numerów dróg (np. „483”) w trybie jazdy/nawigacji.
 * Przy wysokim pitch Mapbox navigation-night duplikuje etykiety wzdłuż drogi.
 */
const TRIP_HIDDEN_LAYERS = [
  'road-number-shield',
  'road-shield',
  'road-number',
  'motorway-junction',
  'motorway-shield',
  'road-label',
  'road-label-small',
  'road-label-medium',
  'road-label-large',
  'road-exit-shield',
  'road-exit',
];

type Props = {
  mapRef: RefObject<Mapbox.MapView | null>;
  enabled: boolean;
  styleEpoch: number;
};

export function TripMapLabelGuard({ mapRef, enabled, styleEpoch }: Props) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const apply = async () => {
      await new Promise((r) => setTimeout(r, 120));
      if (cancelled) return;
      for (const layerId of TRIP_HIDDEN_LAYERS) {
        try {
          await map.setStyleLayerProperty(
            layerId,
            'visibility',
            enabled ? 'none' : 'visible',
          );
        } catch {
          // Layer may not exist in every Mapbox style variant.
        }
      }
    };

    void apply();
    return () => {
      cancelled = true;
    };
  }, [mapRef, enabled, styleEpoch]);

  return null;
}
