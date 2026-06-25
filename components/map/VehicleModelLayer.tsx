import React, { memo, useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';
import type { VehicleModelMeta } from '../../constants/shopCosmetics';
import {
  buildStaticModelRotation,
  buildModelLayerTranslation,
  normalizeVehicleModelMeta,
} from '../../lib/vehicleModelMeta';
import { resolveMapVehicleScale } from '../../lib/mapVehicleScale';
import { SELF_VEHICLE_MODEL_KEY } from '../../lib/vehicleModelRegistry';

type Props = {
  latitude: number;
  longitude: number;
  heading: number;
  modelUrl: string;
  metadata?: VehicleModelMeta | null;
  visible?: boolean;
  idPrefix?: string;
};

function VehicleModelLayerInner({
  latitude,
  longitude,
  heading,
  modelUrl,
  metadata,
  visible = true,
  idPrefix = 'self',
}: Props) {
  const meta = normalizeVehicleModelMeta(metadata);
  const [sx, sy, sz] = resolveMapVehicleScale(meta.scale);
  const modelTranslation = buildModelLayerTranslation(meta);
  const staticRotation = buildStaticModelRotation(
    meta,
    Number.isFinite(heading) ? heading : 0,
  );

  const shape = useMemo(() => ({
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [longitude, latitude] as [number, number],
    },
    properties: { bearing: Number.isFinite(heading) ? heading : 0 },
  }), [longitude, latitude, heading]);

  if (!visible || !modelUrl) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return (
    <Mapbox.ShapeSource id={`${idPrefix}-vehicle-src`} shape={shape}>
      <Mapbox.ModelLayer
        id={`${idPrefix}-vehicle-model`}
        minZoomLevel={5}
        style={{
          modelId: SELF_VEHICLE_MODEL_KEY,
          modelType: 'common-3d',
          modelElevationReference: 'ground',
          modelRotation: staticRotation,
          modelScale: [sx, sy, sz],
          modelTranslation,
          modelOpacity: 1,
          modelCastShadows: false,
          modelReceiveShadows: false,
          modelAllowDensityReduction: true,
        }}
      />
    </Mapbox.ShapeSource>
  );
}

export const VehicleModelLayer = memo(VehicleModelLayerInner);
