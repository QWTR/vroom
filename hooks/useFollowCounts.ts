import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export interface FollowCounts {
  followers: number;
  following: number;
}

export function useFollowCounts(userId: number | string | null | undefined) {
  const [counts, setCounts] = useState<FollowCounts>({ followers: 0, following: 0 });
  const [loading, setLoading] = useState(false);

  const loadCounts = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const token   = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      // Primary: new combined endpoint
      const res = await fetch(`${API_URL}/api/follow/counts/${userId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCounts({
          followers: data.followers ?? data.followersCount ?? data.count ?? 0,
          following: data.following ?? data.followingCount ?? 0,
        });
        return;
      }

      // Fallback: legacy single-count endpoint (only gives followers)
      const legacyRes = await fetch(`${API_URL}/api/follow/count/${userId}`, { headers });
      if (legacyRes.ok) {
        const data = await legacyRes.json();
        setCounts(prev => ({
          ...prev,
          followers: data.followersCount ?? data.count ?? 0,
        }));
      }
    } catch (e) {
      console.warn('[useFollowCounts] failed to fetch counts for userId', userId, e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  return { counts, loading, refetch: loadCounts };
}
