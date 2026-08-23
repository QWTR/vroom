import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import {
  MAX_GLB_BYTES,
  pickEquippedMapVehicle,
  type VehicleModelContractItem,
} from '../lib/vehicleModelContract';
import { subscribeMapVehicleChanged } from '../lib/mapVehicleEvents';
import { subscribeSharedSocket } from '../lib/sharedSocket';
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
  const activeReloadRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    activeReloadRef.current?.abort();
    const controller = new AbortController();
    activeReloadRef.current = controller;
    const isCurrent = () => activeReloadRef.current === controller && !controller.signal.aborted;

    const token = await getToken();
    if (!isCurrent()) return;
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
      // Konfiguracja auta jest edytowana poza aplikacją (panel admina), więc nie
      // może pochodzić z pamięci HTTP urządzenia. Parametr zmienia wyłącznie URL
      // odczytu i nie wpływa na kontrakt endpointu.
      const res = await fetch(`${API_URL}/api/shop/me?vehicleConfigAt=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (!res.ok) {
        setError(`shop/me ${res.status}`);
        setVehicle(null);
        setModelHealth('unknown');
        setModelUri(null);
        return;
      }
      const data = await res.json();
      if (!isCurrent()) return;
      const picked = pickEquippedMapVehicle(data);
      setVehicle(picked);
      setError(picked ? null : 'Brak założonego modelu GLB');

      if (picked?.assetUrl) {
        const peeked = await peekCachedVehicleModelUri(picked.id, picked.assetUrl);
        if (!isCurrent()) return;
        if (peeked) {
          setModelUri(peeked);
          setModelHealth('ok');
        }

        const cached = await getCachedVehicleModelUri(picked.id, picked.assetUrl);
        if (!isCurrent()) return;
        if (cached) {
          setModelUri(cached);
          setModelHealth('ok');
        }

        const probe = await probeGlbHealth(picked.assetUrl);
        if (!isCurrent()) return;
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
          if (!isCurrent()) return;
          if (__DEV__) {
            console.log('[vehicle3d] cached', { localUri });
          }
        } catch (cacheErr) {
          if (!isCurrent()) return;
          if (__DEV__) console.warn('[vehicle3d] cache failed (using remote URL)', cacheErr);
        } finally {
          if (isCurrent()) setModelLoading(false);
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
      if (controller.signal.aborted) return;
      setVehicle(null);
      setModelHealth('unknown');
      setModelUri(null);
      setError(e instanceof Error ? e.message : 'Błąd ładowania modelu');
    } finally {
      if (activeReloadRef.current === controller) {
        activeReloadRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => () => {
    activeReloadRef.current?.abort();
    activeReloadRef.current = null;
  }, []);

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
    let disposed = false;
    let unsubscribe = () => {};
    void subscribeSharedSocket('shop:vehicle-model-changed', () => {
      if (!disposed) void reload();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unsubscribe = cleanup;
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [reload]);

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
