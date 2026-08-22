import { describe, expect, it } from 'vitest';
import {
  MAX_GLB_BYTES,
  normalizeVehicleLiveFields,
  pickEquippedMapVehicle,
} from './vehicleModelContract';

// Już-znormalizowana meta (punkt stały normalize): mobileYawOffset === yawOffset,
// więc kolejne normalize nie dodaje ponownie korekty platformowej.
const modelMetadata = {
  rendererVersion: 3,
  scale: [2, 2, 2],
  yawOffset: 180,
  mobileYawOffset: 180,
  pitch: 1,
  roll: -1,
  pivotX: 0,
  pivotY: 0,
  elevationZ: 1.2,
  calibrationHeading: undefined,
  minZoom: 12,
};

// Surowe legacy {rotationOffset:180} zachowuje yaw 180; pivot wymuszony na 0 (V3).
const legacyNormalizedMetadata = {
  rendererVersion: 3,
  scale: [2, 2, 2],
  yawOffset: 180,
  mobileYawOffset: 180,
  pitch: 1,
  roll: -1,
  pivotX: 0,
  pivotY: 0,
  elevationZ: 1.2,
  calibrationHeading: undefined,
  minZoom: 12,
};

const legacyMetadata = {
  scale: [2, 2, 2],
  rotationOffset: 180,
  rotationPitch: 1,
  rotationRoll: -1,
  translation: [14.6, 0.01, 1.2],
  minZoom: 12,
};

describe('vehicleModelContract', () => {
  it('accepts map vehicle models up to 12 MB', () => {
    expect(MAX_GLB_BYTES).toBe(12 * 1024 * 1024);
  });

  it('picks a fully configured equipped map vehicle from shop/me inventory', () => {
    const vehicle = pickEquippedMapVehicle({
      equipped: { map_vehicle_3d: 'bmw-m3' },
      inventory: [{
        id: 'bmw-m3',
        name: 'BMW M3',
        category: 'map_vehicle_3d',
        assetUrl: 'https://cdn.vroom.test/uploads/vehicles/bmw.glb',
        previewUrl: 'https://cdn.vroom.test/uploads/vehicles/bmw.png',
        assetKind: 'glb',
        metadata: legacyMetadata,
      }],
    });

    expect(vehicle).toEqual({
      id: 'bmw-m3',
      name: 'BMW M3',
      assetUrl: 'https://cdn.vroom.test/uploads/vehicles/bmw.glb',
      previewUrl: 'https://cdn.vroom.test/uploads/vehicles/bmw.png',
      assetKind: 'glb',
      metadata: legacyNormalizedMetadata,
    });
  });

  it('normalizes live model fields without dropping previous model on partial events', () => {
    const previous = normalizeVehicleLiveFields({
      vehicleModelUrl: 'https://cdn.vroom.test/uploads/vehicles/bmw.glb',
      vehicleModelMeta: modelMetadata,
    });

    expect(normalizeVehicleLiveFields({}, previous)).toEqual(previous);
    expect(normalizeVehicleLiveFields({ vehicleModelUrl: null }, previous)).toEqual({
      vehicleModelUrl: null,
      vehicleModelMeta: null,
    });
  });

  it('keeps full shop model config when it is published through live payloads', () => {
    const equipped = pickEquippedMapVehicle({
      equipped: {
        mapVehicle: {
          id: 'rx7',
          name: 'RX-7',
          assetUrl: 'https://cdn.vroom.test/uploads/vehicles/rx7.glb',
          previewUrl: 'https://cdn.vroom.test/uploads/vehicles/rx7.png',
          assetKind: 'glb',
          metadata: modelMetadata,
        },
      },
      inventory: [],
    });

    const live = normalizeVehicleLiveFields({
      vehicleModelUrl: equipped?.assetUrl,
      vehicleModelMeta: equipped?.metadata,
    });

    expect(live).toEqual({
      vehicleModelUrl: 'https://cdn.vroom.test/uploads/vehicles/rx7.glb',
      vehicleModelMeta: modelMetadata,
    });
  });
});
