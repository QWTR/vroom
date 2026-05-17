import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export interface Achievement {
  id:             number;
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
}

const getToken = async (): Promise<string | null> =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export function useAchievements() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading]           = useState(false);

  const fetchMyAchievements = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('no token');
      const authHeaders = { Authorization: `Bearer ${token}` };
      await fetch(`${API_URL}/api/achievements/check`, {
        method: 'POST',
        headers: authHeaders,
      }).catch(() => {});
      const res = await fetch(`${API_URL}/api/achievements/progress`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error();
      const data: Achievement[] = await res.json();
      setAchievements(data.map(a => ({
        ...a,
        active: !!(a.unlocked || a.unlockedAt),
        unlocked: !!(a.unlocked || a.unlockedAt),
      })));
    } catch {
      setAchievements([]);
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