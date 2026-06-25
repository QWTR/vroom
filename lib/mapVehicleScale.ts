import type { VehicleModelMeta } from '../constants/shopCosmetics';

/** Domyślna skala modelu na mapie (metry). Typowy GLB ~0.3–1 jednostki wewnętrzne. */
const DEFAULT_MAP_VEHICLE_SCALE: [number, number, number] = [3, 3, 3];
const MAX_MAP_VEHICLE_SCALE = 8;

function clampScale(n: number): number {
  const v = Number(n) || 1;
  return Math.min(Math.max(v, 0.05), MAX_MAP_VEHICLE_SCALE);
}

/** Skala modelu 3D na mapie — wartość z panelu admina (kalibrator). */
export function resolveMapVehicleScale(
  scale?: VehicleModelMeta['scale'] | null,
): [number, number, number] {
  if (!scale) return DEFAULT_MAP_VEHICLE_SCALE;
  return [
    clampScale(scale[0]),
    clampScale(scale[1]),
    clampScale(scale[2]),
  ];
}
