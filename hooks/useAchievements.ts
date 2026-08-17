import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { mergeAchievementCatalog } from '../constants/achievementCatalog';

export interface Achievement {
  id:             number | string;
  key:            string;
  label:          string;
  description:    string;
  icon:           string;
  category:       string;
  rarity:         'common' | 'rare' | 'epic' | 'legendary';
  points:         number;
  conditionField: string;
  conditionValue: number;
  currentValue:   number;
  progress:       number;
  unlocked:       boolean;
  unlockedAt:     string | null;
  active:         boolean;
  scope?:         'global' | 'season';
  season?:        { id: string; number: number; name: string; status: string } | null;
}

const getToken = async (): Promise<string | null> =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

const achievementCacheKey = async () => {
  const rawUser = await AsyncStorage.getItem('user').catch(() => null);
  if (!rawUser) return 'achievementProgress:v2:current';
  try {
    const id = JSON.parse(rawUser)?.id;
    return `achievementProgress:v2:${id || 'current'}`;
  } catch {
    return 'achievementProgress:v2:current';
  }
};
const normalizeAchievements = (data: Achievement[]) => mergeAchievementCatalog(data.map(a => ({
  ...a,
  active: !!(a.unlocked || a.unlockedAt),
  unlocked: !!(a.unlocked || a.unlockedAt),
})));

export function useAchievements() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading]           = useState(false);

  const fetchMyAchievements = useCallback(async () => {
    setLoading(true);
    let restoredCache = false;
    try {
      const token = await getToken();
      if (!token) throw new Error('no token');
      const authHeaders = { Authorization: `Bearer ${token}` };
      const cacheKey = await achievementCacheKey();

      const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Achievement[];
          if (Array.isArray(parsed) && parsed.length) {
            restoredCache = true;
            setAchievements(parsed);
          }
        } catch {}
      }

      const res = await fetch(`${API_URL}/api/achievements/progress`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      const data: Achievement[] = await res.json();
      const normalized = normalizeAchievements(data);
      setAchievements(normalized);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(normalized)).catch(() => {});

      // Pełne sprawdzanie odbywa się po pokazaniu ekranu. Jeśli coś właśnie
      // odblokowano, lista odświeży się w tle bez blokowania użytkownika.
      void fetch(`${API_URL}/api/achievements/check`, { method: 'POST', headers: authHeaders })
        .then(async (checkResponse) => checkResponse.ok ? checkResponse.json() : null)
        .then(async (checkResult) => {
          if (!checkResult) return;
          const refreshed = await fetch(`${API_URL}/api/achievements/progress`, { headers: authHeaders });
          if (!refreshed.ok) return;
          const next = normalizeAchievements(await refreshed.json());
          setAchievements(next);
          await AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
        })
        .catch(() => {});
    } catch {
      if (!restoredCache) setAchievements([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAchievements = useCallback(async (userId: number) => {
    setLoading(true);
    try {
      const token   = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/profile/${userId}/achievements`, { headers });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAchievements(data.map((a: any) => ({
        ...a,
        active:         true,
        unlocked:       true,
        progress:       100,
        currentValue:   a.conditionValue ?? 0,
        conditionValue: a.conditionValue ?? 0,
        conditionField: a.conditionField ?? '',
      })));
    } catch {
      setAchievements([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { achievements, loading, fetchMyAchievements, fetchAchievements };
}
