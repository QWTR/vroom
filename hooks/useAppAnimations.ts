import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { AppAnimation, AppAnimationSlot } from '../constants/appAnimations';

const CACHE_KEY = 'app_animations_cache_v1';

export function useAppAnimations(slots?: AppAnimationSlot[]) {
  const [animations, setAnimations] = useState<AppAnimation[]>([]);
  const [loading, setLoading] = useState(true);
  const slotsKey = useMemo(() => (slots ?? []).slice().sort().join(','), [slots]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached && !cancelled) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setAnimations(parsed);
        }
      } catch {}

      try {
        const qs = slotsKey ? `?slots=${encodeURIComponent(slotsKey)}` : '';
        const res = await fetch(`${API_URL}/api/app-animations${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        const next = Array.isArray(data?.animations) ? data.animations : [];
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
  }, [slotsKey]);

  return { animations, loading };
}
