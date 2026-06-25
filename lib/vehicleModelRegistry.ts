import { useEffect, useMemo, useState } from 'react';

export const SELF_VEHICLE_MODEL_KEY = 'vroom_vehicle';

/** Rejestr URL → klucz modelu dla Mapbox.Models */
const urlToKey = new Map<string, string>();
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
  if (existing) return existing;
  counter += 1;
  const key = `veh_${counter}`;
  urlToKey.set(normalized, key);
  notifyRegistry();
  return key;
}

export function allRegisteredModels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, key] of urlToKey.entries()) {
    out[key] = url;
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
