import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type Announcement = {
  id:          number;
  title:       string;
  content:     string;       // pełna treść (było body)
  excerpt:     string | null; // krótki opis (było subtitle)
  category:    string;        // 'news' | 'event' | 'update' itp
  coverImage:  string | null; // (było bannerUrl)
  pinned:      boolean;
  published:   boolean;
  createdAt:   string;
  updatedAt:   string;
};

const CACHE_KEY = 'announcements_cache';
const SEEN_KEY  = 'announcements_seen';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

// Kolor akcentu per kategoria
export function categoryColor(category: string): string {
  switch (category) {
    case 'event':  return '#E33933';
    case 'update': return '#C143D7';
    case 'promo':  return '#4CAF50';
    case 'alert':  return '#41CF6B';
    default:       return '#2C92E3'; // news
  }
}

export function categoryEmoji(category: string): string {
  switch (category) {
    case 'event':  return '🏁';
    case 'update': return '🔧';
    case 'promo':  return '🎁';
    case 'alert':  return '⚠️';
    default:       return '📢';
  }
}

export function categoryLabel(category: string): string {
  switch (category) {
    case 'event':  return 'EVENT';
    case 'update': return 'AKTUALIZACJA';
    case 'promo':  return 'PROMOCJA';
    case 'alert':  return 'WAŻNE';
    default:       return 'NOWOŚĆ';
  }
}

export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [seenIds,       setSeenIds]       = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Wczytaj seen z AsyncStorage
      const seenRaw = await AsyncStorage.getItem(SEEN_KEY);
      const seen: number[] = seenRaw ? JSON.parse(seenRaw) : [];
      setSeenIds(seen);

      // Cache najpierw — szybki render
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) setAnnouncements(JSON.parse(cached));

      // Fresh z API
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/announcements`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data: Announcement[] = await res.json();
        setAnnouncements(data); // backend już sortuje pinned desc + createdAt desc
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('useAnnouncements error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const markSeen = useCallback(async (id: number) => {
    setSeenIds(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const markAllSeen = useCallback(async (ids: number[]) => {
    setSeenIds(prev => {
      const next = Array.from(new Set([...prev, ...ids]));
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const unseenCount = announcements.filter(a => !seenIds.includes(a.id)).length;

  return { announcements, loading, seenIds, unseenCount, load, markSeen, markAllSeen };
}