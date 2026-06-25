import { useState, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { VehicleModelMeta } from '../constants/shopCosmetics';
import { normalizeVehicleModelMeta } from '../lib/vehicleModelMeta';

export type EquippedMapVehicle = {
  id: string;
  name: string;
  assetUrl: string;
  previewUrl?: string | null;
  assetKind: string;
  metadata: VehicleModelMeta;
};

export type VehicleModelHealth = 'unknown' | 'ok' | 'too_large' | 'unreachable' | 'bad_type';

const MAX_GLB_BYTES = 8 * 1024 * 1024;

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}


function isVehicleModelUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim();
  if (/\.(glb|gltf)(\?|$)/i.test(u)) return true;
  return /\/uploads\/vehicles\//i.test(u);
}

function isVehicleAssetKind(kind: unknown): boolean {
  const k = String(kind || '').toLowerCase();
  return k === 'glb' || k === 'gltf';
}

function normalizeEquippedRow(row: Record<string, unknown>): EquippedMapVehicle | null {
  const assetUrl = row.assetUrl ? String(row.assetUrl).trim() : '';
  if (!assetUrl) return null;
  if (!isVehicleModelUrl(assetUrl) && !isVehicleAssetKind(row.assetKind)) return null;
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Pojazd 3D'),
    assetUrl,
    previewUrl: row.previewUrl ? String(row.previewUrl) : null,
    assetKind: String(row.assetKind ?? 'glb'),
    metadata: normalizeVehicleModelMeta(row.metadata),
  };
}

function pickEquippedVehicle(data: Record<string, unknown> | null | undefined): EquippedMapVehicle | null {
  if (!data) return null;

  const fromCosmetics = data.equipped as Record<string, unknown> | undefined;
  const mapVehicle = fromCosmetics?.mapVehicle as Record<string, unknown> | null | undefined;
  const fromMapVehicle = mapVehicle ? normalizeEquippedRow(mapVehicle) : null;
  if (fromMapVehicle) return fromMapVehicle;

  const equippedId =
    (mapVehicle?.id as string | undefined)
    ?? (fromCosmetics?.map_vehicle_3d as string | undefined)
    ?? (data.equippedMapVehicleModelId as string | undefined);

  const items = Array.isArray(data.inventory) ? data.inventory : [];
  const fromInventory = items.find(
    (row: { id?: string; category?: string }) =>
      (equippedId && row?.id === equippedId)
      || (!equippedId && row?.category === 'map_vehicle_3d'),
  ) as Record<string, unknown> | undefined;

  return fromInventory ? normalizeEquippedRow(fromInventory) : null;
}

async function probeGlbHealth(url: string): Promise<{ health: VehicleModelHealth; bytes: number }> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return { health: 'unreachable', bytes: 0 };
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    const bytes = Number(res.headers.get('content-length') || 0);
    const typeOk = !ct || ct.includes('gltf') || ct.includes('octet-stream') || ct.includes('model');
    if (!typeOk && !/\.glb(\?|$)/i.test(url)) return { health: 'bad_type', bytes };
    if (bytes > MAX_GLB_BYTES) return { health: 'too_large', bytes };
    return { health: 'ok', bytes };
  } catch {
    return { health: 'unreachable', bytes: 0 };
  }
}

/** Założony model 3D na mapie (własny marker). */
export function useEquippedMapVehicle() {
  const [vehicle, setVehicle] = useState<EquippedMapVehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelHealth, setModelHealth] = useState<VehicleModelHealth>('unknown');
  const [modelBytes, setModelBytes] = useState(0);

  const reload = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setVehicle(null);
      setLoading(false);
      setError(null);
      setModelHealth('unknown');
      setModelBytes(0);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/shop/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError(`shop/me ${res.status}`);
        setVehicle(null);
        setModelHealth('unknown');
        return;
      }
      const data = await res.json();
      const picked = pickEquippedVehicle(data);
      setVehicle(picked);
      setError(picked ? null : 'Brak założonego modelu GLB');

      if (picked?.assetUrl) {
        const probe = await probeGlbHealth(picked.assetUrl);
        setModelHealth(probe.health);
        setModelBytes(probe.bytes);
        if (__DEV__) {
          const mb = probe.bytes > 0 ? (probe.bytes / (1024 * 1024)).toFixed(2) : '?';
          console.log('[vehicle3d] equipped', {
            url: picked.assetUrl,
            preview: picked.previewUrl,
            health: probe.health,
            mb,
            metadata: picked.metadata,
          });
        }
      } else {
        setModelHealth('unknown');
        setModelBytes(0);
      }
    } catch (e) {
      setVehicle(null);
      setModelHealth('unknown');
      setError(e instanceof Error ? e.message : 'Błąd ładowania modelu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reload();
    });
    return () => sub.remove();
  }, [reload]);

  return { vehicle, loading, error, modelHealth, modelBytes, reload };
}
