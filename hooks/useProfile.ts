import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { UserProfile } from '../constants/profile';

const getToken = async (): Promise<string | null> => {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
};

function mapToProfile(u: any): UserProfile {
  return {
    id:            u.userId        ?? u.id,
    username:      u.username,
    location:      u.location      ?? null,
    bio:           u.bio           ?? null,
    avatarUrl:     u.avatarUrl     ?? u.avatar ?? null,
    bannerUrl:     u.bannerUrl     ?? null,
    createdAt:     u.createdAt     ?? new Date().toISOString(),
    totalDistance:   u.totalDistance   ?? 0,
    dailyDistance:   u.dailyDistance   ?? 0,
    topSpeed:        u.topSpeed        ?? 0,
    avgSpeed:        u.avgSpeed        != null ? Number(u.avgSpeed) : 0,
    avgMaxSpeed:     u.avgMaxSpeed     != null ? Number(u.avgMaxSpeed) : 0,
    monthlyDistance: u.monthlyDistance != null ? Number(u.monthlyDistance) : 0,
    weeklyDistance:  u.weeklyDistance  != null ? Number(u.weeklyDistance) : 0,
    totalRides:      u.totalRides      ?? 0,
    monthlyRides:    u.monthlyRides    ?? 0,
    streak:          u.streak          ?? 0,
    points:          u.points          ?? 0,
    meetCount:     u.meetCount     ?? 0,
    cityCount:     u.cityCount     ?? 0,
    position:      u.position      ?? null,
    isPremium:     !!u.isPremium,
    club:          u.club          ?? null,
    followersCount: u.followersCount ?? 0,  
    followingCount: u.followingCount ?? 0,  
  };
}


export function useProfile() {
  const [profile,       setProfile]       = useState<UserProfile | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // ── Własny profil ─────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token    = await getToken();
      const localRaw = await AsyncStorage.getItem('user');

      // 1. Pokaż natychmiast z cache (bez club — cache nie przechowuje)
      if (localRaw) {
        setProfile(mapToProfile(JSON.parse(localRaw)));
      }

      if (!token) throw new Error('Brak tokenu');

      // 2. Odśwież z serwera — tu będzie club
      const res = await fetch(`${API_URL}/api/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data   = await res.json();
        const mapped = mapToProfile(data);
        setProfile(mapped);

        // Cache — zachowaj userId i inne pola, club nie cachujemy
        if (localRaw) {
          const old = JSON.parse(localRaw);
          await AsyncStorage.setItem('user', JSON.stringify({
            ...old,
            ...data,
            avatarUrl: mapped.avatarUrl,
            avatar:    mapped.avatarUrl,
            club:      undefined, // nie cachuj — zawsze świeże z serwera
          }));
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Publiczny profil ──────────────────────────────────
  const fetchPublicProfile = useCallback(async (userId: number) => {
    setLoading(true);
    setError(null);
    try {
      const token   = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/profile/${userId}`, { headers });
      if (!res.ok) throw new Error('Błąd pobierania profilu');
      const data = await res.json();
      setProfile(mapToProfile(data));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Aktualizacja profilu ──────────────────────────────
  const updateProfile = useCallback(async (
    fields: Partial<Pick<UserProfile, 'username' | 'location' | 'bio'>>
  ) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/profile/me`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) throw new Error('Błąd aktualizacji profilu');
      const data   = await res.json();
      const mapped = mapToProfile(data);
      setProfile(mapped);

      const localRaw = await AsyncStorage.getItem('user');
      const old      = localRaw ? JSON.parse(localRaw) : {};
      await AsyncStorage.setItem('user', JSON.stringify({
        ...old,
        ...data,
        avatarUrl: mapped.avatarUrl,
        avatar:    mapped.avatarUrl,
      }));
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Upload avatara ────────────────────────────────────
  const uploadAvatar = useCallback(async (imageUri: string): Promise<boolean> => {
    setAvatarLoading(true);
    setError(null);
    try {
      const token    = await getToken();
      const filename = imageUri.split('/').pop() ?? 'avatar.jpg';
      const match    = /\.(\w+)$/.exec(filename);
      const mimeType = match ? `image/${match[1]}` : 'image/jpeg';

      const form = new FormData();
      form.append('avatar', { uri: imageUri, name: filename, type: mimeType } as any);

      const res = await fetch(`${API_URL}/api/profile/avatar`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    form,
      });

      if (!res.ok) throw new Error('Błąd uploadu avatara');
      const { avatarUrl } = await res.json();

      setProfile(prev => prev ? { ...prev, avatarUrl } : prev);

      const localRaw = await AsyncStorage.getItem('user');
      const old      = localRaw ? JSON.parse(localRaw) : {};
      await AsyncStorage.setItem('user', JSON.stringify({
        ...old,
        avatarUrl,
        avatar: avatarUrl,
      }));

      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setAvatarLoading(false);
    }
  }, []);

  return {
    profile, loading, avatarLoading, error,
    fetchProfile, fetchPublicProfile, updateProfile, uploadAvatar,
  };
}