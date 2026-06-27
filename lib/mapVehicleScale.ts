import type { VehicleModelMeta } from '../constants/shopCosmetics';

/** Default map model scale. V3 GLB assets are already normalized in meters. */
const DEFAULT_MAP_VEHICLE_SCALE: [number, number, number] = [1, 1, 1];

function resolveScaleAxis(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** 3D model scale from admin config, applied without artificial clamps. */
export function resolveMapVehicleScale(
  scale?: VehicleModelMeta['scale'] | null,
): [number, number, number] {
  if (!scale) return DEFAULT_MAP_VEHICLE_SCALE;
  return [
    resolveScaleAxis(scale[0]),
    resolveScaleAxis(scale[1]),
    resolveScaleAxis(scale[2]),
  ];
}
