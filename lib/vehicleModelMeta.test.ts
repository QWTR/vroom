import { describe, expect, it } from 'vitest';
import {
  buildSelfVehicleModelLayerStyle,
  buildVehicleModelFeatureProperties,
  computeVehicleModelYaw,
  normalizeVehicleModelMeta,
} from './vehicleModelMeta';

describe('vehicleModelMeta', () => {
  it('computes modelYaw = heading + yawOffset (admin formula)', () => {
    expect(computeVehicleModelYaw(0, 0)).toBe(0);
    expect(computeVehicleModelYaw(90, 0)).toBe(90);
    expect(computeVehicleModelYaw(350, 20)).toBe(10);
    expect(computeVehicleModelYaw(10, -45)).toBe(325);
    expect(computeVehicleModelYaw(359, 1)).toBe(0);
    expect(computeVehicleModelYaw(270, 90)).toBe(0);
  });

  it('normalizes admin metadata without applying legacy pivot offsets', () => {
    const meta = normalizeVehicleModelMeta({
      scale: [2, 3, 4],
      rotationOffset: 180,
      rotationPitch: 5,
      rotationRoll: -3,
      translation: [14.6, 0.01, 3],
      minZoom: 14,
      calibrationHeading: 90,
    });

    expect(meta).toMatchObject({
      rendererVersion: 3,
      scale: [2, 3, 4],
      yawOffset: 270,
      pitch: 5,
      roll: -3,
      pivotX: 0,
      pivotY: 0,
      elevationZ: 3,
      minZoom: 14,
      calibrationHeading: 90,
    });
  });

  it('builds full ModelLayer feature properties from metadata', () => {
    expect(buildVehicleModelFeatureProperties({
      scale: [2, 3, 4],
      yawOffset: 90,
      pitch: 4,
      roll: -2,
      elevationZ: 3,
      minZoom: 13,
    }, 270)).toEqual({
      modelRot0: 4,
      modelRot1: -2,
      modelRot2: 90,
      transX: 0,
      transY: 0,
      transZ: 3,
      scaleX: 2,
      scaleY: 3,
      scaleZ: 4,
      minZoom: 13,
    });
  });

  it('keeps native model centered and ignores legacy pivot offsets', () => {
    expect(buildVehicleModelFeatureProperties({
      scale: [4, 4, 4],
      yawOffset: 0,
      pivotX: 12,
      pivotY: 0,
      elevationZ: 1,
      calibrationHeading: 90,
      minZoom: 10,
    }, 90)).toMatchObject({
      transX: 0,
      transY: 0,
      transZ: 1,
      modelRot2: 180,
    });
  });

  it('reads legacy scaleX/Y/Z when scale array is missing (with +90 mobile flip)', () => {
    const meta = normalizeVehicleModelMeta({
      scaleX: 2.5,
      scaleY: 2.5,
      scaleZ: 2.5,
      yawOffset: 90,
    });
    expect(meta.scale).toEqual([2.5, 2.5, 2.5]);
    expect(meta.yawOffset).toBe(180);
  });

  it('applies +90 mobile platform flip when mobileYawOffset absent', () => {
    expect(normalizeVehicleModelMeta({ yawOffset: 90 }).yawOffset).toBe(180);
    expect(normalizeVehicleModelMeta({ yawOffset: 0 }).yawOffset).toBe(90);
  });

  it('buildSelfVehicleModelLayerStyle uses literal scale, rotation added in component', () => {
    const style = buildSelfVehicleModelLayerStyle('vroom_vehicle', {
      scale: [2.5, 2.5, 2.5],
      yawOffset: 90,
      pitch: 3,
      roll: -1,
      elevationZ: 0.8,
    });
    expect(style.modelScale).toEqual([2.5, 2.5, 2.5]);
    expect(style.modelTranslation).toEqual([0, 0, 0.8]);
    expect(style).not.toHaveProperty('modelRotation');
  });

  it('prefers explicit mobileYawOffset over legacy rotation fields (no extra flip)', () => {
    const meta = normalizeVehicleModelMeta({
      yawOffset: 10,
      mobileYawOffset: 45,
      rotationOffset: 180,
    });
    expect(meta.yawOffset).toBe(45);
  });

  it('modelRot2 = heading + (webYaw + 90 mobile flip)', () => {
    const props = buildVehicleModelFeatureProperties({
      scale: [1, 1, 1],
      yawOffset: 90,
      minZoom: 10,
    }, 97);

    // yawOffset 90 → mobile 180; 97 + 180 = 277
    expect(props.modelRot2).toBe(277);
  });
});
