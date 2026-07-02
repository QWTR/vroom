import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { AppAnimation, AppAnimationSlot } from '../constants/appAnimations';

const CACHE_KEY = 'app_animations_cache_v2';
const FETCH_TIMEOUT_MS = 10000;

function filterBySlots(items: AppAnimation[], slots?: AppAnimationSlot[]) {
  if (!slots?.length) return items;
  const allowed = new Set(slots);
  return items.filter((item) => allowed.has(item.slot));
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function useAppAnimations(slots?: AppAnimationSlot[]) {
  const [animations, setAnimations] = useState<AppAnimation[]>([]);
  const [loading, setLoading] = useState(true);
  const slotsKey = useMemo(() => (slots ?? []).slice().sort().join(','), [slots]);
  const requestedSlots = useMemo(() => (slotsKey ? slotsKey.split(',') as AppAnimationSlot[] : []), [slotsKey]);

  useEffect(() => {
    let cancelled = false;
    let cacheReady = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached && !cancelled) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            const next = filterBySlots(parsed, requestedSlots);
            if (next.length > 0) {
              setAnimations(next);
              cacheReady = true;
              setLoading(false);
            }
          }
        }
      } catch {}

      try {
        const qs = slotsKey
          ? `?slots=${encodeURIComponent(slotsKey)}&_=${Date.now()}`
          : `?_=${Date.now()}`;
        const res = await fetchWithTimeout(`${API_URL}/api/app-animations${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        const all = Array.isArray(data?.animations) ? data.animations : [];
        const next = filterBySlots(all, requestedSlots);
        if (!cancelled) {
          setAnimations(next);
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(all));
        }
      } catch {
        /* cache fallback */
      } finally {
        if (!cancelled && !cacheReady) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [requestedSlots, slotsKey]);

  return { animations, loading };
}
