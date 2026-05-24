import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { API_URL }  from '../constants/config';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export function useNotifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {}
    finally { setLoading(false); }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifications();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const schedule = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      if (AppState.currentState !== 'active') return;
      intervalId = setInterval(fetchNotifications, 30_000);
    };

    schedule();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        fetchNotifications();
      }
      schedule();
    });

    return () => {
      if (intervalId) clearInterval(intervalId);
      sub.remove();
    };
  }, [fetchNotifications]);

  return { notifications, unreadCount, loading, fetchNotifications, markAllRead };
}