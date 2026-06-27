import { useEffect, useMemo, useState } from 'react';
import { cacheVehicleModelUri } from './vehicleModelCache';

export const SELF_VEHICLE_MODEL_KEY = 'vroom_vehicle';

/** Rejestr URL → klucz modelu dla Mapbox.Models */
const urlToKey = new Map<string, string>();
const keyToModelUri = new Map<string, string>();
const cacheInFlight = new Set<string>();
let counter = 0;
let registryVersion = 0;
const listeners = new Set<() => void>();

function notifyRegistry() {
  registryVersion += 1;
  listeners.forEach((fn) => fn());
}

export function modelKeyForUrl(url: string): string {
  const normalized = url.trim();
  if (!normalized) return '';
  const existing = urlToKey.get(normalized);
  const key = existing ?? `veh_${++counter}`;
  if (!existing) {
    urlToKey.set(normalized, key);
    keyToModelUri.set(key, normalized);
    notifyRegistry();
  }
  if (!cacheInFlight.has(normalized) && /^https?:\/\//i.test(normalized)) {
    cacheInFlight.add(normalized);
    // Cache w tle (offline), ale Mapbox.Models zostaje na HTTPS — file:// psuje URI na Androidzie.
    void cacheVehicleModelUri(key, normalized)
      .catch(() => {})
      .finally(() => {
        cacheInFlight.delete(normalized);
      });
  }
  return key;
}

export function allRegisteredModels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, key] of urlToKey.entries()) {
    const uri = keyToModelUri.get(key);
    if (uri) out[key] = uri;
  }
  return out;
}

export function registerModelUrl(url: string | null | undefined): string {
  if (!url) return '';
  return modelKeyForUrl(url);
}

export function useMapVehicleModels(selfModelUrl?: string | null): Record<string, string> {
  const [version, setVersion] = useState(registryVersion);

  useEffect(() => {
    const onChange = () => setVersion(registryVersion);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return useMemo(() => {
    const out = { ...allRegisteredModels() };
    const selfUrl = selfModelUrl?.trim();
    if (selfUrl) out[SELF_VEHICLE_MODEL_KEY] = selfUrl;
    return out;
  }, [selfModelUrl, version]);
}
