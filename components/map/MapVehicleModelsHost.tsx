import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';
import { useMapVehicleModels } from '../../lib/vehicleModelRegistry';

type Props = {
  selfModelUrl?: string | null;
};

/** Jedna instancja Mapbox.Models dla własnego pojazdu + floty LIVE. */
function MapVehicleModelsHostInner({ selfModelUrl }: Props) {
  const models = useMapVehicleModels(selfModelUrl);
  if (Object.keys(models).length === 0) return null;
  return <Mapbox.Models models={models} />;
}

export const MapVehicleModelsHost = memo(MapVehicleModelsHostInner);
