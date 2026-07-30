import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export interface MonthStat {
  month: string;
  label: string;
  distance: number;
  maxSpeed: number;
  rides: number;
}

export function useMonthlyStats(enabled: boolean) {
  const [data,    setData]    = useState<MonthStat[]>([]);
  const [diff,    setDiff]    = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      setLoading(true);
      try {
        const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
        const res   = await fetch(`${API_URL}/api/profile/stats/monthly`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const d = await res.json();
          setData(d.months ?? []);
          setDiff(d.distanceDiff ?? 0);
        }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [enabled]);

  return { data, diff, loading };
}
