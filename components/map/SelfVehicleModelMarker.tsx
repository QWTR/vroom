import React, { memo } from 'react';
import type { UseDriveMarkerV3Return } from '../../hooks/useDriveMarkerV3';
import type { VehicleModelMeta } from '../../constants/shopCosmetics';
import type { VehicleModelHealth } from '../../hooks/useEquippedMapVehicle';
import { SelfVehicleModelLayer } from './SelfVehicleModelLayer';
import { VehicleMarkerView3D } from './VehicleMarkerView3D';
import { VehicleModelLayer } from './VehicleModelLayer';

type Props = {
  enabled: boolean;
  isTripActive: boolean;
  driveMarker: UseDriveMarkerV3Return;
  browseLat: number;
  browseLng: number;
  browseHeading: number;
  modelUrl: string;
  previewUrl?: string | null;
  metadata?: VehicleModelMeta | null;
  modelHealth: VehicleModelHealth;
  useNativeModelLayer: boolean;
};

function SelfVehicleModelMarkerInner({
  enabled,
  isTripActive,
  driveMarker,
  browseLat,
  browseLng,
  browseHeading,
  modelUrl,
  previewUrl,
  metadata,
  modelHealth,
  useNativeModelLayer,
}: Props) {
  if (!enabled) return null;

  const lat = browseLat;
  const lng = browseLng;
  const heading = browseHeading;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const nativeOk = useNativeModelLayer && modelHealth === 'ok' && !!modelUrl;
  const previewFallback = !nativeOk;

  return (
    <>
      {nativeOk && isTripActive ? (
        <SelfVehicleModelLayer
          key={metadata ? `${metadata.rotationOffset}-${metadata.translation?.join(',')}-${metadata.scale?.join(',')}` : 'default'}
          marker={driveMarker}
          metadata={metadata}
          visible
        />
      ) : null}
      {nativeOk && !isTripActive ? (
        <VehicleModelLayer
          idPrefix="self"
          latitude={lat}
          longitude={lng}
          heading={heading}
          modelUrl={modelUrl}
          metadata={metadata}
          visible
        />
      ) : null}
      {previewFallback ? (
        <VehicleMarkerView3D
          latitude={lat}
          longitude={lng}
          heading={heading}
          previewUrl={previewUrl}
          metadata={metadata}
        />
      ) : null}
    </>
  );
}

export const SelfVehicleModelMarker = memo(SelfVehicleModelMarkerInner);
