import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
export type AccountProgression = { enabled: boolean; xp: string; level: number; currentLevelXp: string; nextLevelXp: string; xpToNextLevel: string; progress: number; nextRewardLevel: number; configVersion: number; rewardsPending: boolean };
export async function levelRequest(path: string, init: RequestInit = {}) {
  const token = await AsyncStorage.getItem('userToken') ?? await AsyncStorage.getItem('token');
  if (!token) throw new Error('Zaloguj się ponownie.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_URL}/api/account-levels${path}`, { ...init, signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers } });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || 'Nie udało się pobrać poziomu konta. Spróbuj ponownie.');
    return data;
  } finally { clearTimeout(timer); }
}
export function useAccountProgression() {
  const [data, setData] = useState<AccountProgression | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await levelRequest('/me')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się pobrać poziomu.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { data, error, loading, reload };
}
