import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { ALL_ACHIEVEMENTS } from '../constants/profile';
import type { AchievementRecord } from '../constants/profile';

const getToken = async (): Promise<string | null> => {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
};

export function useAchievements() {
  const [achievements, setAchievements] = useState(
    ALL_ACHIEVEMENTS.map(a => ({ ...a, active: false }))
  );
  const [loading, setLoading] = useState(false);

  const fetchAchievements = useCallback(async (userId: number) => {
    setLoading(true);
    try {
      const token   = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res  = await fetch(`${API_URL}/api/profile/${userId}/achievements`, { headers });
      if (!res.ok) throw new Error();
      const data: AchievementRecord[] = await res.json();

      const unlocked = new Map(data.map(a => [a.type, a]));
      setAchievements(
        ALL_ACHIEVEMENTS.map(a => ({
          ...a,
          active:     unlocked.has(a.type),
          unlockedAt: unlocked.get(a.type)?.unlockedAt,
        }))
      );
    } catch {
      // zostaw domyślne (wszystkie inactive)
    } finally {
      setLoading(false);
    }
  }, []);

  return { achievements, loading, fetchAchievements };
}