import { useState, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import {
  MAX_GLB_BYTES,
  pickEquippedMapVehicle,
  type VehicleModelContractItem,
} from '../lib/vehicleModelContract';
import { subscribeMapVehicleChanged } from '../lib/mapVehicleEvents';
import {
  cacheVehicleModelUri,
  getCachedVehicleModelUri,
  peekCachedVehicleModelUri,
  preloadVehicleModel,
} from '../lib/vehicleModelCache';

export type EquippedMapVehicle = VehicleModelContractItem;

export type VehicleModelHealth = 'unknown' | 'ok' | 'too_large' | 'unreachable' | 'bad_type';

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

async function probeGlbHealth(url: string): Promise<{ health: VehicleModelHealth; bytes: number }> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) {
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      const bytes = Number(res.headers.get('content-length') || 0);
      const typeOk = !ct || ct.includes('gltf') || ct.includes('octet-stream') || ct.includes('model');
      if (!typeOk && !/\.glb(\?|$)/i.test(url)) return { health: 'bad_type', bytes };
      if (bytes > MAX_GLB_BYTES) return { health: 'too_large', bytes };
      return { health: 'ok', bytes };
    }
  } catch {
    /* HEAD często blokowany — próbujemy GET */
  }

  try {
    const getRes = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
    if (!getRes.ok && getRes.status !== 206) return { health: 'unreachable', bytes: 0 };
    const bytes = Number(getRes.headers.get('content-length') || 0);
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
  const [modelLoading, setModelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelHealth, setModelHealth] = useState<VehicleModelHealth>('unknown');
  const [modelBytes, setModelBytes] = useState(0);
  const [modelUri, setModelUri] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setVehicle(null);
      setLoading(false);
      setModelLoading(false);
      setError(null);
      setModelHealth('unknown');
      setModelBytes(0);
      setModelUri(null);
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
        setModelUri(null);
        return;
      }
      const data = await res.json();
      const picked = pickEquippedMapVehicle(data);
      setVehicle(picked);
      setError(picked ? null : 'Brak założonego modelu GLB');

      if (picked?.assetUrl) {
        const peeked = await peekCachedVehicleModelUri(picked.id, picked.assetUrl);
        if (peeked) {
          setModelUri(peeked);
          setModelHealth('ok');
        }

        const cached = await getCachedVehicleModelUri(picked.id, picked.assetUrl);
        if (cached) {
          setModelUri(cached);
          setModelHealth('ok');
        }

        const probe = await probeGlbHealth(picked.assetUrl);
        setModelBytes(probe.bytes);

        if (probe.health === 'too_large') {
          setModelHealth('too_large');
          setModelUri(null);
        } else {
          // Zawsze renderuj z HTTPS (jak panel admina). HEAD/GET na mobile często pada mimo działającego GLB.
          setModelHealth('ok');
          setModelUri(picked.assetUrl);
        }

        setModelLoading(true);
        try {
          const localUri = await cacheVehicleModelUri(picked.id, picked.assetUrl);
          if (__DEV__) {
            console.log('[vehicle3d] cached', { localUri });
          }
        } catch (cacheErr) {
          if (__DEV__) console.warn('[vehicle3d] cache failed (using remote URL)', cacheErr);
        } finally {
          setModelLoading(false);
        }

        if (__DEV__) {
          const mb = probe.bytes > 0 ? (probe.bytes / (1024 * 1024)).toFixed(2) : '?';
          console.log('[vehicle3d] equipped', {
            url: picked.assetUrl,
            renderUrl: picked.assetUrl,
            cached: cached ?? peeked,
            health: probe.health,
            mb,
            metadata: picked.metadata,
          });
        }
      } else {
        setModelHealth('unknown');
        setModelBytes(0);
        setModelUri(null);
        setModelLoading(false);
      }
    } catch (e) {
      setVehicle(null);
      setModelHealth('unknown');
      setModelUri(null);
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

  useEffect(() => subscribeMapVehicleChanged(() => {
    void reload();
  }), [reload]);

  useEffect(() => {
    if (vehicle?.id && vehicle.assetUrl) {
      preloadVehicleModel(vehicle.id, vehicle.assetUrl);
    }
  }, [vehicle?.id, vehicle?.assetUrl]);

  return {
    vehicle,
    loading,
    modelLoading,
    error,
    modelHealth,
    modelBytes,
    modelUri,
    modelReady: modelHealth === 'ok' && !!vehicle?.assetUrl,
    reload,
  };
}
