import type { VehicleModelMeta } from '../constants/shopCosmetics';
import { normalizeVehicleModelMeta } from './vehicleModelMeta';

export const MAP_VEHICLE_3D_CATEGORY = 'map_vehicle_3d';
export const MAX_GLB_BYTES = 12 * 1024 * 1024;

export type VehicleModelContractItem = {
  id: string;
  name: string;
  assetUrl: string;
  previewUrl: string | null;
  assetKind: 'glb' | 'gltf';
  metadata: VehicleModelMeta;
};

export type VehicleLiveModelFields = {
  vehicleModelUrl: string | null;
  vehicleModelMeta: VehicleModelMeta | null;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
}

function stringOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

export function isVehicleModelUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim();
  if (/\.(glb|gltf)(\?|$)/i.test(u)) return true;
  return /\/uploads\/vehicles\//i.test(u);
}

export function isVehicleAssetKind(kind: unknown): kind is 'glb' | 'gltf' {
  const k = String(kind || '').toLowerCase();
  return k === 'glb' || k === 'gltf';
}

export function normalizeVehicleContractItem(raw: unknown): VehicleModelContractItem | null {
  const row = asRecord(raw);
  if (!row) return null;

  const assetUrl = stringOrNull(row.assetUrl);
  const assetKindRaw = String(row.assetKind || '').toLowerCase();
  const hasVehicleAssetKind = isVehicleAssetKind(assetKindRaw);
  const assetKind: 'glb' | 'gltf' = hasVehicleAssetKind ? assetKindRaw : 'glb';
  if (!assetUrl) return null;
  if (!isVehicleModelUrl(assetUrl) && !hasVehicleAssetKind) return null;

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Pojazd 3D'),
    assetUrl,
    previewUrl: stringOrNull(row.previewUrl),
    assetKind,
    metadata: normalizeVehicleModelMeta(row.metadata),
  };
}

export function pickEquippedMapVehicle(data: unknown): VehicleModelContractItem | null {
  const payload = asRecord(data);
  if (!payload) return null;

  const equipped = asRecord(payload.equipped);
  const mapVehicle = asRecord(equipped?.mapVehicle);
  const direct = normalizeVehicleContractItem(mapVehicle);
  if (direct) return direct;

  const equippedId =
    stringOrNull(mapVehicle?.id)
    ?? stringOrNull(equipped?.[MAP_VEHICLE_3D_CATEGORY])
    ?? stringOrNull(payload.equippedMapVehicleModelId);

  const inventory = Array.isArray(payload.inventory) ? payload.inventory : [];
  const item = inventory.find((candidate) => {
    const row = asRecord(candidate);
    if (!row) return false;
    const rowId = stringOrNull(row.id);
    const category = stringOrNull(row.category);
    return (equippedId != null && rowId === equippedId)
      || (equippedId == null && category === MAP_VEHICLE_3D_CATEGORY);
  });

  return normalizeVehicleContractItem(item);
}

export function normalizeVehicleLiveFields(
  raw: {
    vehicleModelUrl?: unknown;
    vehicleModelMeta?: unknown;
  },
  previous?: {
    vehicleModelUrl?: string | null;
    vehicleModelMeta?: VehicleModelMeta | null;
  } | null,
): VehicleLiveModelFields {
  const prevUrl = previous?.vehicleModelUrl ?? null;
  const prevMeta = previous?.vehicleModelMeta ?? null;

  const vehicleModelUrl = raw.vehicleModelUrl === undefined
    ? prevUrl
    : stringOrNull(raw.vehicleModelUrl);

  const vehicleModelMeta = raw.vehicleModelMeta === undefined
    ? prevMeta
    : (raw.vehicleModelMeta == null ? null : normalizeVehicleModelMeta(raw.vehicleModelMeta));

  return {
    vehicleModelUrl,
    vehicleModelMeta: vehicleModelUrl ? vehicleModelMeta : null,
  };
}
