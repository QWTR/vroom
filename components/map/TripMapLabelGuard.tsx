import { useEffect } from 'react';
import type { RefObject } from 'react';
import Mapbox from '@rnmapbox/maps';
import { collectTripHiddenLayerIds } from '../../lib/mapScreen/tripMapLabelLayers';

const APPLY_DELAYS_MS = [80, 240, 700, 1400];

type Props = {
  mapRef: RefObject<Mapbox.MapView | null>;
  enabled: boolean;
  styleEpoch: number;
};

async function getStyleLayerIds(map: Mapbox.MapView): Promise<string[]> {
  const anyMap = map as unknown as {
    getStyle?: () => Promise<string | { layers?: Array<{ id?: string }> }>;
  };
  if (typeof anyMap.getStyle !== 'function') return [];
  try {
    const style = await anyMap.getStyle();
    const parsed = typeof style === 'string' ? JSON.parse(style) : style;
    if (!parsed || !Array.isArray(parsed.layers)) return [];
    return parsed.layers
      .map((layer: { id?: unknown }) => (typeof layer?.id === 'string' ? layer.id : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function TripMapLabelGuard({ mapRef, enabled, styleEpoch }: Props) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const apply = async () => {
      if (cancelled) return;
      const styleLayerIds = await getStyleLayerIds(map);
      if (cancelled) return;
      for (const layerId of collectTripHiddenLayerIds(styleLayerIds)) {
        try {
          await (map as unknown as {
            setStyleLayerProperty: (id: string, property: string, value: string) => Promise<void>;
          }).setStyleLayerProperty(
            layerId,
            'visibility',
            enabled ? 'none' : 'visible',
          );
        } catch {
          // Layer may not exist in every Mapbox style variant.
        }
      }
    };

    for (const delay of APPLY_DELAYS_MS) {
      timers.push(setTimeout(() => void apply(), delay));
    }
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [mapRef, enabled, styleEpoch]);

  return null;
}
