import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';
import { useMapVehicleModels } from '../../lib/vehicleModelRegistry';

type Props = {
  /** Preferuj HTTPS z shop — file:// psuje się w RNMBXModels na Androidzie. */
  selfModelUrl?: string | null;
  styleEpoch: number;
};

function pickModelsUrl(url?: string | null): string {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return '';
  // Zdalny URL jak w panelu kalibracji; lokalny cache tylko gdy nie ma https.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed;
}

/** Jedna instancja Mapbox.Models dla własnego pojazdu + floty LIVE. */
function MapVehicleModelsHostInner({ selfModelUrl, styleEpoch }: Props) {
  const resolvedSelfUrl = pickModelsUrl(selfModelUrl);
  const models = useMapVehicleModels(resolvedSelfUrl || null);
  const modelKeys = Object.keys(models).sort();
  if (styleEpoch <= 0 || modelKeys.length === 0) return null;
  return (
    <Mapbox.Models
      key={`models-${styleEpoch}-${modelKeys.join('|')}-${resolvedSelfUrl || 'fleet-only'}`}
      models={models}
    />
  );
}

export const MapVehicleModelsHost = memo(MapVehicleModelsHostInner);
