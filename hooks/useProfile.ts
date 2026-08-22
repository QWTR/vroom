import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { onProfileClubUpdated } from '../lib/profileClubSync';
import { onProfileStatsUpdated } from '../lib/profileStatsSync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import type { UserProfile } from '../constants/profile';
import { mergeProfilePremiumExtras } from '../constants/profilePremiumExtras';
import {
  AVATAR_BUST_STORAGE_KEY,
  avatarUrlHasVersion,
  withAvatarCacheBust,
} from '../lib/avatarUri';
import { filterVisibleRideHistory } from '../lib/activityHistoryFilter';
import { apiRequest } from '../lib/api/client';
import { queryClient } from '../lib/query/client';

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
    discord: u.discord ?? null,
    club:          opts?.includeClub ? (u.club ?? null) : null,
    followersCount: u.followersCount ?? u.counts?.followers ?? 0,
    followingCount: u.followingCount ?? u.counts?.following ?? 0,
    nitroBalance: u.nitroBalance ?? 0,
    shopCosmetics: u.shopCosmetics ?? null,
    gamificationSummary: u.gamificationSummary ?? null,
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
  const [activityHistoryNextCursor, setActivityHistoryNextCursor] = useState<string | null>(null);
  const [activityHistoryHasMore, setActivityHistoryHasMore] = useState(false);
  const [activityHistoryLoadingMore, setActivityHistoryLoadingMore] = useState(false);
  const [activityHistoryAccessLimit, setActivityHistoryAccessLimit] = useState<number | null>(null);
  const activityHistoryRequestRef = useRef(false);
  const routeRequestsRef = useRef<Set<number>>(new Set());
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

      const avatarBustRaw = await AsyncStorage.getItem(AVATAR_BUST_STORAGE_KEY);
      const avatarCacheBust = avatarBustRaw ? Number(avatarBustRaw) : null;

      // 2. Query pokazuje świeży cache natychmiast i deduplikuje równoległe wejścia.
      const data = await queryClient.fetchQuery({
        queryKey: ['profile', 'me'],
        queryFn: ({ signal }) => apiRequest<any>('/profile/me', { signal, priority: 'critical' }),
        staleTime: 30_000,
      });
      if (data) {
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
      const data = await queryClient.fetchQuery({
        queryKey: ['profile', userId, 'summary'],
        queryFn: ({ signal }) => apiRequest<{ profile: any }>(`/v2/profiles/${userId}/summary`, { signal }),
        staleTime: 30_000,
      });
      setProfile(mapToProfile(data.profile, { includeClub: true }));
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
      const data = await apiRequest<any>('/profile/me', {
        method:  'PATCH',
        body: fields,
      });
      const avatarBustRaw = await AsyncStorage.getItem(AVATAR_BUST_STORAGE_KEY);
      const avatarCacheBust = avatarBustRaw ? Number(avatarBustRaw) : null;
      const mapped = mapToProfile(data, {
        includeClub: true,
        avatarCacheBust: Number.isFinite(avatarCacheBust) ? avatarCacheBust : null,
      });
      setProfile((prev) => ({
        ...(prev || mapped),
        ...mapped,
        totalDistance: mapped.totalDistance || prev?.totalDistance || 0,
        dailyDistance: mapped.dailyDistance || prev?.dailyDistance || 0,
        topSpeed: mapped.topSpeed || prev?.topSpeed || 0,
        monthlyDistance: mapped.monthlyDistance || prev?.monthlyDistance || 0,
        weeklyDistance: mapped.weeklyDistance || prev?.weeklyDistance || 0,
        totalRides: mapped.totalRides || prev?.totalRides || 0,
        monthlyRides: mapped.monthlyRides || prev?.monthlyRides || 0,
        club: mapped.club ?? prev?.club ?? null,
        gamificationSummary: mapped.gamificationSummary ?? prev?.gamificationSummary ?? null,
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
      await queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
      await queryClient.invalidateQueries({ queryKey: ['profile', mapped.id, 'summary'] });
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

      const data = await apiRequest<{ avatarUrl?: string }>('/profile/avatar', {
        method:  'POST',
        body: form,
      });
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
      await queryClient.invalidateQueries({ queryKey: ['profile'] });

      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Błąd połączenia przy wysyłaniu avatara.';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setAvatarLoading(false);
    }
  }, []);

  const fetchActivityHistory = useCallback(async (opts?: {
    cursor?: string | null;
    append?: boolean;
    reset?: boolean;
    limit?: number;
  }) => {
    if (activityHistoryRequestRef.current) return;
    activityHistoryRequestRef.current = true;
    const append = !!opts?.append && !opts?.reset;
    setActivityHistoryLoadingMore(append);
    try {
      const limit = Math.min(20, Math.max(1, opts?.limit ?? 20));
      const cursor = opts?.cursor ? `&cursor=${encodeURIComponent(opts.cursor)}` : '';
      const data = await queryClient.fetchQuery({
        queryKey: ['activity', 'history', limit, opts?.cursor || null],
        queryFn: ({ signal }) => apiRequest<any>(`/activity/history?limit=${limit}${cursor}`, {
          signal,
          priority: append ? 'background' : 'visible',
        }),
        staleTime: 20_000,
      });
      const items = filterVisibleRideHistory(data.items ?? []);
      setActivityHistory((previous) => {
        if (!append) return items;
        const merged = new Map<number, any>();
        for (const item of previous) merged.set(Number(item.id), item);
        for (const item of items) merged.set(Number(item.id), item);
        return Array.from(merged.values());
      });
      setActivityHistoryNextCursor(data.nextCursor ? String(data.nextCursor) : null);
      setActivityHistoryHasMore(Boolean(data.hasMore));
      setActivityHistoryAccessLimit(
        data.accessLimit != null && Number.isFinite(Number(data.accessLimit))
          ? Number(data.accessLimit)
          : null,
      );
    } catch {
      /* keep the already loaded page */
    } finally {
      activityHistoryRequestRef.current = false;
      setActivityHistoryLoadingMore(false);
    }
  }, []);

  const fetchNextActivityHistoryPage = useCallback(async () => {
    if (!activityHistoryHasMore || !activityHistoryNextCursor) return;
    await fetchActivityHistory({
      cursor: activityHistoryNextCursor,
      append: true,
      limit: 20,
    });
  }, [activityHistoryHasMore, activityHistoryNextCursor, fetchActivityHistory]);

  const fetchActivityRoute = useCallback(async (activityId: number) => {
    const id = Number(activityId);
    if (!Number.isInteger(id) || id <= 0 || routeRequestsRef.current.has(id)) return null;
    routeRequestsRef.current.add(id);
    try {
      const data = await queryClient.fetchQuery({
        queryKey: ['activity', 'history', id, 'route'],
        queryFn: ({ signal }) => apiRequest<any>(`/activity/history/${id}/route`, { signal, priority: 'visible' }),
        staleTime: 24 * 60 * 60_000,
      });
      const routePoints = Array.isArray(data?.routePoints) ? data.routePoints : [];
      let hydrated: any = null;
      setActivityHistory((previous) => previous.map((item) => {
        if (Number(item.id) !== id) return item;
        hydrated = { ...item, routePoints, hasRoute: routePoints.length > 1 };
        return hydrated;
      }));
      return hydrated ?? { id, routePoints, hasRoute: routePoints.length > 1 };
    } catch {
      return null;
    } finally {
      routeRequestsRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    return onProfileStatsUpdated(() => {
      void fetchProfile();
      void fetchActivityHistory({ reset: true, limit: 20 });
    });
  }, [fetchProfile, fetchActivityHistory]);

  const fetchMonthlyStats = useCallback(async () => {
    try {
      const [stats, compare] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ['activity', 'monthly-stats', 12],
          queryFn: ({ signal }) => apiRequest<any>('/activity/monthly-stats?months=12', { signal, priority: 'background' }),
          staleTime: 60_000,
        }),
        queryClient.fetchQuery({
          queryKey: ['activity', 'monthly-compare'],
          queryFn: ({ signal }) => apiRequest<any>('/activity/monthly-compare', { signal, priority: 'background' }),
          staleTime: 60_000,
        }),
      ]);
      setMonthlyStats(stats?.stats ?? []);
      setMonthlyCompare(compare ?? null);
    } catch {}
  }, []);

  return {
    profile, loading, avatarLoading, error,
    activityHistory, activityHistoryNextCursor, activityHistoryHasMore,
    activityHistoryLoadingMore, activityHistoryAccessLimit, monthlyStats, monthlyCompare,
    fetchProfile, fetchPublicProfile, updateProfile, uploadAvatar,
    fetchActivityHistory, fetchNextActivityHistoryPage, fetchActivityRoute, fetchMonthlyStats,
  };
}
