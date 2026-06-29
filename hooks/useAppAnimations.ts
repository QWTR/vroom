import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { AppAnimation, AppAnimationSlot } from '../constants/appAnimations';

const CACHE_KEY = 'app_animations_cache_v2';

function filterBySlots(items: AppAnimation[], slots?: AppAnimationSlot[]) {
  if (!slots?.length) return items;
  const allowed = new Set(slots);
  return items.filter((item) => allowed.has(item.slot));
}

export function useAppAnimations(slots?: AppAnimationSlot[]) {
  const [animations, setAnimations] = useState<AppAnimation[]>([]);
  const [loading, setLoading] = useState(true);
  const slotsKey = useMemo(() => (slots ?? []).slice().sort().join(','), [slots]);
  const requestedSlots = useMemo(() => (slotsKey ? slotsKey.split(',') as AppAnimationSlot[] : []), [slotsKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached && !cancelled) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setAnimations(filterBySlots(parsed, requestedSlots));
        }
      } catch {}

      try {
        const qs = slotsKey
          ? `?slots=${encodeURIComponent(slotsKey)}&_=${Date.now()}`
          : `?_=${Date.now()}`;
        const res = await fetch(`${API_URL}/api/app-animations${qs}`, {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return;
        const data = await res.json();
        const next = filterBySlots(Array.isArray(data?.animations) ? data.animations : [], requestedSlots);
        if (!cancelled) {
          setAnimations(next);
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
        }
      } catch {
        /* cache fallback */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [requestedSlots, slotsKey]);

  return { animations, loading };
}
