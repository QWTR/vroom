import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { onProfileClubUpdated } from '../lib/profileClubSync';
import { onProfileStatsUpdated } from '../lib/profileStatsSync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { API_URL } from '../constants/config';
import type { UserProfile } from '../constants/profile';
import { mergeProfilePremiumExtras } from '../constants/profilePremiumExtras';
import {
  AVATAR_BUST_STORAGE_KEY,
  avatarUrlHasVersion,
  withAvatarCacheBust,
} from '../lib/avatarUri';
import { filterVisibleRideHistory } from '../lib/activityHistoryFilter';

const getToken = async (): Promise<string | null> => {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
};

function mapToProfile(u: any, opts?: { includeClub?: boolean; avatarCacheBust?: number | null }): UserProfile {
  let avatarUrl = u.avatarUrl ?? u.avatar ?? null;
  if (avatarUrl && opts?.avatarCacheBust && !avatarUrlHasVersion(avatarUrl)) {
    avatarUrl = withAvatarCacheBust(avatarUrl, opts.avatarCacheBust);
  }
  return {
    id:            u.userId        ?? u.id,
    username:      u.username,
    location:      u.location      ?? null,
    province:      u.province      ?? null,
    bio:           u.bio           ?? null,
    avatarUrl,
    createdAt:     u.createdAt     ?? new Date().toISOString(),
    totalDistance:   Number(u.totalDistance ?? 0) || 0,
    dailyDistance:   Number(u.dailyDistance ?? 0) || 0,
    topSpeed:        Number(u.topSpeed ?? 0) || 0,
    avgSpeed:        u.avgSpeed != null ? Number(u.avgSpeed) : 0,
    avgMaxSpeed:     u.avgMaxSpeed != null ? Number(u.avgMaxSpeed) : 0,
    monthlyDistance: u.monthlyDistance != null ? Number(u.monthlyDistance) : 0,
    weeklyDistance:  u.weeklyDistance != null ? Number(u.weeklyDistance) : 0,
    totalRides:      u.totalRides      ?? 0,
    monthlyRides:    u.monthlyRides    ?? 0,
    streak:          u.streak          ?? 0,
    points:          u.points          ?? 0,
    meetCount:     u.meetCount     ?? 0,
    cityCount:     u.cityCount     ?? 0,
    position:      u.position      ?? null,
    isPremium:     !!u.isPremium,
    premiumExpiresAt: u.premiumExpiresAt ?? null,
    nickColor: u.isPremium ? (u.nickColor ?? null) : null,
    profileThemePreset: u.isPremium ? (u.profileThemePreset ?? 'default') : 'default',
    avatarFramePreset: u.isPremium ? (u.avatarFramePreset ?? 'vroom') : 'vroom',
    accountTheme: u.isPremium ? (u.accountTheme ?? null) : null,
    bannerUrl: u.isPremium ? (u.bannerUrl ?? null) : null,
    profilePremiumExtras: u.isPremium ? mergeProfilePremiumExtras(u.profilePremiumExtras) : null,
    spotifyProfileTrack: u.spotifyProfileTrack ?? null,
    club:          opts?.includeClub ? (u.club ?? null) : null,
    followersCount: u.followersCount ?? 0,  
    followingCount: u.followingCount ?? 0,
    nitroBalance: u.nitroBalance ?? 0,
    shopCosmetics: u.shopCosmetics ?? null,
  };
}

function normalizeProfileClub(club: any): UserProfile['club'] {
  if (!club) return null;
  const rank = club.myRank;
  return {
    id: Number(club.id),
    name: String(club.name ?? ''),
    avatarUrl: club.avatarUrl ?? null,
    memberCount: Number(club.memberCount ?? 0) || 0,
    myRole: String(club.myRole ?? 'member'),
    myRank: rank && typeof rank === 'object' && typeof rank.name === 'string' && typeof rank.color === 'string'
      ? { name: rank.name, color: rank.color }
      : null,
  };
}


export function useProfile() {
  const [profile,       setProfile]       = useState<UserProfile | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [activityHistory, setActivityHistory] = useState<any[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<any[]>([]);
  const [monthlyCompare, setMonthlyCompare] = useState<any | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  profileRef.current = profile;

  /** Cache z AsyncStorage — zanim pierwszy fetch, żeby uniknąć pustego/czarnego ekranu na iOS. */
  useLayoutEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const localRaw = await AsyncStorage.getItem('user');
        if (!localRaw || cancelled) return;
        const avatarBustRaw = await AsyncStorage.getItem(AVATAR_BUST_STORAGE_KEY);
        const avatarCacheBust = avatarBustRaw ? Number(avatarBustRaw) : null;
        const cached = JSON.parse(localRaw);
        delete cached.club;
        const mappedCached = mapToProfile(cached, {
          avatarCacheBust: Number.isFinite(avatarCacheBust) ? avatarCacheBust : null,
        });
        if (cancelled) return;
        setProfile((prev) => {
          if (!prev) return mappedCached;
          return { ...mappedCached, club: prev.club ?? null };
        });
        setLoading(false);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Własny profil ─────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    const hadProfile = profileRef.current != null;
    if (!hadProfile) setLoading(true);
    setError(null);
    try {
      const token    = await getToken();
      const localRaw = await AsyncStorage.getItem('user');

      // 1. Pokaż natychmiast z cache, ale nie nadpisuj istniejącego cluba w UI.
      const avatarBustRawEarly = await AsyncStorage.getItem(AVATAR_BUST_STORAGE_KEY);
      const avatarCacheBustEarly = avatarBustRawEarly ? Number(avatarBustRawEarly) : null;
      if (localRaw) {
        const cached = JSON.parse(localRaw);
        delete cached.club;
        setProfile((prev) => {
          const mappedCached = mapToProfile(cached, {
            avatarCacheBust: Number.isFinite(avatarCacheBustEarly) ? avatarCacheBustEarly : null,
          });
          if (!prev) return mappedCached;
          return { ...mappedCached, club: prev.club ?? null };
        });
      }

      if (!token) throw new Error('Brak tokenu');

      const avatarBustRaw = await AsyncStorage.getItem(AVATAR_BUST_STORAGE_KEY);
      const avatarCacheBust = avatarBustRaw ? Number(avatarBustRaw) : null;

      // 2. Odśwież z serwera — tu będzie club
      const res = await fetch(`${API_URL}/api/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data   = await res.json();
        const mapped = mapToProfile(data, {
          includeClub: true,
          avatarCacheBust: Number.isFinite(avatarCacheBust) ? avatarCacheBust : null,
        });
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
      setProfile((prev) => (prev ? { ...prev, club: normalizeProfileClub(club) } : prev));
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
    fields: Partial<Pick<UserProfile, 'username' | 'location' | 'bio' | 'province'>>
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
      const avatarBustRaw = await AsyncStorage.getItem(AVATAR_BUST_STORAGE_KEY);
      const avatarCacheBust = avatarBustRaw ? Number(avatarBustRaw) : null;
      const mapped = mapToProfile(data, {
        includeClub: true,
        avatarCacheBust: Number.isFinite(avatarCacheBust) ? avatarCacheBust : null,
      });
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
      let avatarUrl = data?.avatarUrl as string | undefined;
      if (!avatarUrl) {
        const msg = 'Serwer nie zwrócił adresu avatara.';
        setError(msg);
        return { ok: false, error: msg };
      }

      if (avatarUrlHasVersion(avatarUrl)) {
        await AsyncStorage.removeItem(AVATAR_BUST_STORAGE_KEY);
      } else {
        const bust = Date.now();
        await AsyncStorage.setItem(AVATAR_BUST_STORAGE_KEY, String(bust));
        avatarUrl = withAvatarCacheBust(avatarUrl, bust);
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
      const includeRoute = (opts?.includeRoute ?? true) ? 'true' : 'false';
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
          allItems.push(...filterVisibleRideHistory(data.items ?? []));
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
      setActivityHistory(filterVisibleRideHistory(data.items ?? []));
    } catch {}
  }, []);

  useEffect(() => {
    return onProfileStatsUpdated(() => {
      void fetchProfile();
      void fetchActivityHistory({ includeRoute: true, limit: 50 });
    });
  }, [fetchProfile, fetchActivityHistory]);

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
