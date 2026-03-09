import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { UserProfile } from '../constants/profile';

// Pobiera token – sprawdza oba klucze (kompatybilność)
const getToken = async (): Promise<string | null> => {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
};

// Mapuje obiekt z auth.js na UserProfile
function mapAuthUserToProfile(u: any): UserProfile {
  return {
    id:            u.userId   ?? u.id,
    username:      u.username,
    location:      u.location    ?? null,
    bio:           u.bio         ?? null,
    avatarUrl:     u.avatarUrl   ?? u.avatar ?? null,
    createdAt:     u.createdAt   ?? new Date().toISOString(),
    totalDistance: u.totalDistance  ?? 0,
    dailyDistance: u.dailyDistance  ?? 0,
    topSpeed:      u.topSpeed       ?? 0,
    points:        u.points         ?? 0,
    meetCount:     u.meetCount      ?? 0,
    cityCount:     u.cityCount      ?? 0,
    position:      u.position       ?? null,
  };
}

export function useProfile() {
  const [profile,       setProfile]       = useState<UserProfile | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // ── Własny profil ─────────────────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token     = await getToken();
      const localRaw  = await AsyncStorage.getItem('user');
      const localUser = localRaw ? JSON.parse(localRaw) : null;

      // Pokaż od razu dane z cache
      if (localUser) {
        setProfile(mapAuthUserToProfile(localUser));
      }

      if (!token) throw new Error('Brak tokenu');

      // Dociągnij świeże dane z API
      const res = await fetch(`${API_URL}/api/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data: UserProfile = await res.json();
        setProfile(data);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Publiczny profil ──────────────────────────────────────────────────────
  const fetchPublicProfile = useCallback(async (userId: number) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/profile/${userId}`, { headers });
      if (!res.ok) throw new Error('Błąd pobierania profilu');
      setProfile(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Aktualizacja profilu ──────────────────────────────────────────────────
  const updateProfile = useCallback(async (
    fields: Partial<Pick<UserProfile, 'username' | 'location' | 'bio'>>
  ) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/profile/me`, {
        method:  'PATCH',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error('Błąd aktualizacji profilu');
      const data: UserProfile = await res.json();
      setProfile(data);

      // Zaktualizuj cache
      const localRaw  = await AsyncStorage.getItem('user');
      const localUser = localRaw ? JSON.parse(localRaw) : {};
      await AsyncStorage.setItem('user', JSON.stringify({ ...localUser, ...data }));
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Upload avatara ────────────────────────────────────────────────────────
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

      // Zaktualizuj stan
      setProfile(prev => prev ? { ...prev, avatarUrl } : prev);

      // Zaktualizuj cache – oba pola (avatarUrl i avatar dla HomeScreen)
      const localRaw  = await AsyncStorage.getItem('user');
      const localUser = localRaw ? JSON.parse(localRaw) : {};
      await AsyncStorage.setItem('user', JSON.stringify({
        ...localUser,
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