import { useState, useCallback, useEffect } from 'react';
import { onProfileClubUpdated } from '../lib/profileClubSync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { API_URL } from '../constants/config';
import type { UserProfile } from '../constants/profile';
import { mergeProfilePremiumExtras } from '../constants/profilePremiumExtras';

const getToken = async (): Promise<string | null> => {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
};

function mapToProfile(u: any, opts?: { includeClub?: boolean }): UserProfile {
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
    premiumExpiresAt: u.premiumExpiresAt ?? null,
    nickColor: u.nickColor ?? null,
    profileThemePreset: u.profileThemePreset ?? 'default',
    avatarFramePreset: u.avatarFramePreset ?? 'vroom',
    accountTheme: u.accountTheme ?? null,
    profilePremiumExtras: u.isPremium ? mergeProfilePremiumExtras(u.profilePremiumExtras) : null,
    spotifyProfileTrack: u.spotifyProfileTrack ?? null,
    club:          opts?.includeClub ? (u.club ?? null) : null,
    followersCount: u.followersCount ?? 0,  
    followingCount: u.followingCount ?? 0,  
  };
}


export function useProfile() {
  const [profile,       setProfile]       = useState<UserProfile | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [activityHistory, setActivityHistory] = useState<any[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<any[]>([]);
  const [monthlyCompare, setMonthlyCompare] = useState<any | null>(null);

  // ── Własny profil ─────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token    = await getToken();
      const localRaw = await AsyncStorage.getItem('user');

      // 1. Pokaż natychmiast z cache, ale nie nadpisuj istniejącego cluba w UI.
      if (localRaw) {
        const cached = JSON.parse(localRaw);
        delete cached.club;
        setProfile((prev) => {
          const mappedCached = mapToProfile(cached);
          if (!prev) return mappedCached;
          return { ...mappedCached, club: prev.club ?? null };
        });
      }

      if (!token) throw new Error('Brak tokenu');

      // 2. Odśwież z serwera — tu będzie club
      const res = await fetch(`${API_URL}/api/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data   = await res.json();
        const mapped = mapToProfile(data, { includeClub: true });
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

  useEffect(() => {
    return onProfileClubUpdated((club) => {
      setProfile((prev) => (prev ? { ...prev, club } : prev));
    });
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
      setProfile(mapToProfile(data, { includeClub: true }));
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
      const mapped = mapToProfile(data, { includeClub: true });
      setProfile((prev) => ({
        ...mapped,
        club: mapped.club ?? prev?.club ?? null,
      }));

      const localRaw = await AsyncStorage.getItem('user');
      const old      = localRaw ? JSON.parse(localRaw) : {};
      await AsyncStorage.setItem('user', JSON.stringify({
        ...old,
        ...data,
        avatarUrl: mapped.avatarUrl,
        avatar:    mapped.avatarUrl,
        club:      undefined,
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
  const uploadAvatar = useCallback(async (imageUri: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    setAvatarLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        const msg = 'Brak sesji — zaloguj się ponownie.';
        setError(msg);
        return { ok: false, error: msg };
      }

      let uploadUri = imageUri;
      try {
        const out = await ImageManipulator.manipulateAsync(
          imageUri,
          [{ resize: { width: 1024 } }],
          { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
        );
        uploadUri = out.uri;
      } catch {
        const msg =
          'Nie udało się przetworzyć zdjęcia (np. HEIC lub uszkodzony plik). Wybierz inne zdjęcie lub zrób nowe zdjęcie JPEG.';
        setError(msg);
        return { ok: false, error: msg };
      }

      const form = new FormData();
      form.append('avatar', { uri: uploadUri, name: 'avatar.jpg', type: 'image/jpeg' } as any);

      const res = await fetch(`${API_URL}/api/profile/avatar`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    form,
      });

      if (!res.ok) {
        let msg = `Błąd serwera (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error && typeof j.error === 'string') msg = j.error;
        } catch {
          try {
            const t = await res.text();
            if (t?.length && t.length < 200) msg = t;
          } catch { /* ignore */ }
        }
        setError(msg);
        return { ok: false, error: msg };
      }

      const data = await res.json();
      const avatarUrl = data?.avatarUrl as string | undefined;
      if (!avatarUrl) {
        const msg = 'Serwer nie zwrócił adresu avatara.';
        setError(msg);
        return { ok: false, error: msg };
      }

      setProfile(prev => prev ? { ...prev, avatarUrl } : prev);

      const localRaw = await AsyncStorage.getItem('user');
      const old      = localRaw ? JSON.parse(localRaw) : {};
      await AsyncStorage.setItem('user', JSON.stringify({
        ...old,
        avatarUrl,
        avatar: avatarUrl,
      }));

      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Błąd połączenia przy wysyłaniu avatara.';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setAvatarLoading(false);
    }
  }, []);

  const fetchActivityHistory = useCallback(async (opts?: { page?: number; includeRoute?: boolean; limit?: number; allPages?: boolean }) => {
    try {
      const token = await getToken();
      if (!token) return;
      const page = opts?.page ?? 1;
      const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
      const includeRoute = opts?.includeRoute ? 'true' : 'false';
      if (opts?.allPages) {
        const allItems: any[] = [];
        let nextPage = 1;
        let totalPages = 1;
        do {
          const res = await fetch(`${API_URL}/api/activity/history?page=${nextPage}&limit=${limit}&includeRoute=${includeRoute}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) break;
          const data = await res.json();
          allItems.push(...(data.items ?? []));
          totalPages = Number(data.pages ?? 1);
          nextPage += 1;
        } while (nextPage <= totalPages);
        setActivityHistory(allItems);
        return;
      }
      const res = await fetch(`${API_URL}/api/activity/history?page=${page}&limit=${limit}&includeRoute=${includeRoute}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setActivityHistory(data.items ?? []);
    } catch {}
  }, []);

  const fetchMonthlyStats = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const [statsRes, compareRes] = await Promise.all([
        fetch(`${API_URL}/api/activity/monthly-stats?months=12`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/activity/monthly-compare`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (statsRes.ok) {
        const data = await statsRes.json();
        setMonthlyStats(data.stats ?? []);
      }
      if (compareRes.ok) {
        const data = await compareRes.json();
        setMonthlyCompare(data);
      }
    } catch {}
  }, []);

  return {
    profile, loading, avatarLoading, error,
    activityHistory, monthlyStats, monthlyCompare,
    fetchProfile, fetchPublicProfile, updateProfile, uploadAvatar,
    fetchActivityHistory, fetchMonthlyStats,
  };
}