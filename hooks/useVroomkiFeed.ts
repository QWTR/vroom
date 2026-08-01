import { useCallback, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useRouter } from 'expo-router';
import { API_URL } from '../constants/config';
import { useSettings } from '../contexts/SettingsContext';
import {
  type VroomkiPost,
} from '../app/Community/community/communityShared';
import {
  reportContent,
  showBlockUserAlert,
  syncBlockedUserIdsFromServer,
} from '../lib/ugcActions';
import { prepareUploadImages } from '../lib/prepareUploadImages';
import { subscribeVroomkiPublish } from '../lib/vroomkiPublishQueue';
import type { VroomkiCreatePayload } from '../lib/vroomkiTypes';
import { fetchDiversifiedSponsoredAd, type SponsoredCampaign } from './sponsoredAdStore';

const PAGE_SIZE = 20;
/** Organic posts between sponsored slots (after the mandatory first ad). */
const VROOMKI_AD_EVERY = 5;
const getToken = () => AsyncStorage.getItem('token');
const VROOMKI_FREE_VIDEO_MAX_BYTES = 250 * 1024 * 1024;

type AdRotationState = {
  campaignIds: number[];
  businessIds: number[];
  slot: number;
  organicSinceAd: number;
};

function createAdRotationState(): AdRotationState {
  return { campaignIds: [], businessIds: [], slot: 0, organicSinceAd: 0 };
}

function sponsoredCampaignToVroomkiPost(campaign: SponsoredCampaign, slot: number): VroomkiPost {
  const isVideo = campaign.mediaType === 'video' && !!campaign.videoUrl;
  // Unique synthetic id per feed slot so the same campaign can appear later without FlatList collisions.
  const syntheticId = -(campaign.id * 10_000 + (slot % 10_000));
  return {
    id: syntheticId,
    caption: campaign.body || campaign.title,
    photos: isVideo ? [] : (campaign.imageUrl ? [campaign.imageUrl] : []),
    videos: isVideo && campaign.videoUrl ? [campaign.videoUrl] : [],
    videoThumbnailUrl: campaign.imageUrl,
    mediaType: isVideo ? 'video' : 'photo',
    createdAt: new Date().toISOString(),
    author: {
      id: 0,
      username: campaign.companyName || 'Sponsor',
      avatarUrl: null,
      points: 0,
    },
    car: null,
    likesCount: 0,
    commentsCount: 0,
    viewsCount: 0,
    isLiked: false,
    sponsored: {
      campaignId: campaign.id,
      linkUrl: campaign.linkUrl,
      ctaText: campaign.ctaText || 'Dowiedz się więcej',
      companyName: campaign.companyName,
    },
  };
}

async function pullNextVroomkiAd(state: AdRotationState): Promise<VroomkiPost | null> {
  const campaign = await fetchDiversifiedSponsoredAd('vroomki', {
    excludeCampaignIds: state.campaignIds,
    excludeBusinessIds: state.businessIds,
  });
  if (!campaign) return null;

  state.slot += 1;
  state.campaignIds = [...state.campaignIds.filter((id) => id !== campaign.id), campaign.id].slice(-24);
  if (campaign.businessAccountId) {
    state.businessIds = [
      ...state.businessIds.filter((id) => id !== campaign.businessAccountId),
      campaign.businessAccountId,
    ].slice(-12);
  }
  state.organicSinceAd = 0;
  return sponsoredCampaignToVroomkiPost(campaign, state.slot);
}

/** Always starts with an ad, then inserts another after every VROOMKI_AD_EVERY organic posts. */
async function weaveVroomkiAds(
  organic: VroomkiPost[],
  state: AdRotationState,
  { leadWithAd }: { leadWithAd: boolean },
): Promise<VroomkiPost[]> {
  const out: VroomkiPost[] = [];

  if (leadWithAd) {
    const first = await pullNextVroomkiAd(state);
    if (first) out.push(first);
  }

  for (const post of organic) {
    out.push(post);
    state.organicSinceAd += 1;
    if (state.organicSinceAd >= VROOMKI_AD_EVERY) {
      const next = await pullNextVroomkiAd(state);
      if (next) out.push(next);
      else state.organicSinceAd = 0;
    }
  }

  return out;
}

type LocalLikeState = {
  isLiked: boolean;
  likesCount: number;
};

export function useVroomkiFeed(
  initialVroomkiId?: number | null,
  soundId?: number | null,
  authorUserId?: number | null,
  searchQuery?: string | null,
) {
  const router = useRouter();
  const { settings } = useSettings();

  const [myId, setMyId] = useState<number | null>(null);
  const [blockedIds, setBlockedIds] = useState<number[]>([]);

  const [vroomkiPosts, setVroomkiPosts] = useState<VroomkiPost[]>([]);
  const [loadingC, setLoadingC] = useState(false);
  const [refreshingC, setRefreshingC] = useState(false);
  const [carCursor, setCarCursor] = useState<number | null>(null);
  const [loadingMoreC, setLoadingMoreC] = useState(false);
  const [hasMoreC, setHasMoreC] = useState(true);
  const [resolvedFocusPostId, setResolvedFocusPostId] = useState<number | null>(initialVroomkiId ?? null);
  const focusedVroomkiRef = useRef<VroomkiPost | null>(null);
  const postsRef = useRef<VroomkiPost[]>([]);
  const excludeIdsRef = useRef<number[]>([]);
  const blockedIdsRef = useRef<number[]>([]);
  const localLikesRef = useRef<Map<number, LocalLikeState>>(new Map());
  const pendingLikeIdsRef = useRef<Set<number>>(new Set());
  const fetchVroomkiRef = useRef<((cursor?: number) => Promise<void>) | null>(null);
  const adRotationRef = useRef<AdRotationState>(createAdRotationState());

  blockedIdsRef.current = blockedIds;

  const setPosts = useCallback((updater: VroomkiPost[] | ((prev: VroomkiPost[]) => VroomkiPost[])) => {
    const next = typeof updater === 'function' ? updater(postsRef.current) : updater;
    postsRef.current = next;
    setVroomkiPosts(next);
  }, []);

  const mergeLocalState = useCallback((incoming: VroomkiPost): VroomkiPost => {
    const localLike = localLikesRef.current.get(incoming.id);
    if (!localLike) return incoming;
    return { ...incoming, ...localLike };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('user').then((raw) => {
      if (!raw) return;
      try {
        const u = JSON.parse(raw);
        setMyId(u.userId ?? u.id);
      } catch {
        // ignore
      }
    });
  }, []);

  useEffect(() => {
    void syncBlockedUserIdsFromServer().then((ids) => {
      blockedIdsRef.current = ids;
      setBlockedIds(ids);
      setPosts((prev) => prev.filter((p) => !ids.includes(p.author.id)));
    });
  }, [setPosts]);

  useEffect(() => {
    return subscribeVroomkiPublish((event) => {
      if (event.type !== 'success') return;
      const post = event.post;
      console.info('[useVroomkiFeed] publish success received', { postId: post.id });
      focusedVroomkiRef.current = post;
      setResolvedFocusPostId(post.id);
      setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
    });
  }, [setPosts]);

  const normalizedSearchQuery = String(searchQuery ?? '').trim();

  const fetchVroomki = useCallback(
    async (cursor?: number) => {
      if (!cursor) setLoadingC(true);
      const blocked = blockedIdsRef.current;
      try {
        const token = await getToken();
        const authorFilterId = Number.isFinite(authorUserId ?? NaN) ? authorUserId : null;
        const exclude = authorFilterId || normalizedSearchQuery ? '' : excludeIdsRef.current.join(',');
        const soundQuery = Number.isFinite(soundId ?? NaN) ? `&soundId=${soundId}` : '';
        const encodedSearch = encodeURIComponent(normalizedSearchQuery);
        const url = normalizedSearchQuery
          ? cursor
            ? `${API_URL}/api/vroomki/search?q=${encodedSearch}&cursor=${cursor}&limit=${PAGE_SIZE}`
            : `${API_URL}/api/vroomki/search?q=${encodedSearch}&limit=${PAGE_SIZE}`
          : authorFilterId
          ? `${API_URL}/api/vroomki/user/${authorFilterId}?limit=60`
          : cursor
          ? `${API_URL}/api/vroomki?cursor=${cursor}&limit=${PAGE_SIZE}&exclude=${exclude}${soundQuery}`
          : `${API_URL}/api/vroomki?limit=${PAGE_SIZE}${soundQuery}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('fetch vroomki failed');
        const json = await res.json();
        const rawPosts: VroomkiPost[] = (Array.isArray(json) ? json : json.posts ?? []) as VroomkiPost[];
        const mergedPosts = rawPosts
          .filter((post) => !blocked.includes(post.author.id))
          .map(mergeLocalState);

        excludeIdsRef.current = Array.from(new Set([...excludeIdsRef.current, ...mergedPosts.map((p) => p.id)]));

        if (!cursor && focusedVroomkiRef.current) {
          const focusedId = focusedVroomkiRef.current.id;
          const incomingFocused = mergedPosts.find((p) => p.id === focusedId);
          focusedVroomkiRef.current = mergeLocalState(incomingFocused ?? focusedVroomkiRef.current);
        }
        const nextCursor = authorFilterId
          ? null
          : (Array.isArray(json) ? null : json.nextCursor ?? null);

        const allowAds = !authorFilterId
          && !normalizedSearchQuery
          && !Number.isFinite(soundId ?? NaN);

        if (cursor && !authorFilterId) {
          const existingIds = new Set(postsRef.current.map((p) => p.id));
          const organicTail = mergedPosts.filter((p) => !existingIds.has(p.id) && !p.sponsored);
          const wovenTail = allowAds
            ? await weaveVroomkiAds(organicTail, adRotationRef.current, { leadWithAd: false })
            : organicTail;
          setPosts((prev) => {
            const ids = new Set(prev.map((p) => p.id));
            return [...prev, ...wovenTail.filter((p) => !ids.has(p.id))];
          });
        } else {
          if (!cursor) adRotationRef.current = createAdRotationState();
          let organic = [...mergedPosts];
          const focused = focusedVroomkiRef.current;
          if (focused) {
            organic = [focused, ...organic.filter((p) => p.id !== focused.id)];
          }
          // The main Vroomki feed always starts with a sponsored slot.
          const leadWithAd = allowAds;
          const woven = allowAds
            ? await weaveVroomkiAds(organic, adRotationRef.current, { leadWithAd })
            : organic;
          setPosts(woven);
        }
        setCarCursor(nextCursor);
        setHasMoreC(!!nextCursor);
      } catch {
        Toast.show({ type: 'error', text1: 'Błąd ładowania VROOMKI' });
      } finally {
        setLoadingC(false);
        setRefreshingC(false);
        setLoadingMoreC(false);
      }
    },
    [authorUserId, mergeLocalState, normalizedSearchQuery, setPosts, soundId],
  );

  fetchVroomkiRef.current = fetchVroomki;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      excludeIdsRef.current = [];
      adRotationRef.current = createAdRotationState();
      const focusId = initialVroomkiId ?? null;
      if (focusId && Number.isFinite(focusId)) {
        try {
          const token = await getToken();
          const res = await fetch(`${API_URL}/api/vroomki/${focusId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!cancelled && res.ok) {
            const post: VroomkiPost = await res.json();
            const merged = mergeLocalState(post);
            focusedVroomkiRef.current = merged;
            setResolvedFocusPostId(merged.id);
            setPosts((prev) => [merged, ...prev.filter((p) => p.id !== merged.id)]);
          }
        } catch {
          // ignore
        }
      } else if (!cancelled) {
        focusedVroomkiRef.current = null;
        setResolvedFocusPostId(null);
      }
      if (!cancelled) await fetchVroomkiRef.current?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [authorUserId, initialVroomkiId, mergeLocalState, normalizedSearchQuery, setPosts, soundId]);

  const refresh = useCallback(() => {
    setRefreshingC(true);
    setHasMoreC(true);
    setCarCursor(null);
    excludeIdsRef.current = [];
    adRotationRef.current = createAdRotationState();
    void fetchVroomki();
  }, [fetchVroomki]);

  const loadMore = useCallback(() => {
    if (Number.isFinite(authorUserId ?? NaN) && !normalizedSearchQuery) return;
    if (!carCursor || loadingMoreC || !hasMoreC) return;
    setLoadingMoreC(true);
    void fetchVroomki(carCursor);
  }, [authorUserId, carCursor, fetchVroomki, hasMoreC, loadingMoreC, normalizedSearchQuery]);

  const patchPost = useCallback((id: number, patch: Partial<VroomkiPost>) => {
    const current = postsRef.current.find((p) => p.id === id);
    if (patch.isLiked !== undefined || patch.likesCount !== undefined) {
      localLikesRef.current.set(id, {
        isLiked: patch.isLiked ?? current?.isLiked ?? false,
        likesCount: patch.likesCount ?? current?.likesCount ?? 0,
      });
    }
    setPosts((prev) =>
      prev.map((p) => (p.id !== id ? p : { ...p, ...patch })),
    );
    if (focusedVroomkiRef.current?.id === id) {
      focusedVroomkiRef.current = { ...focusedVroomkiRef.current, ...patch };
    }
  }, [setPosts]);

  const handleLikeVroomki = useCallback(
    async (id: number) => {
      if (pendingLikeIdsRef.current.has(id)) return;
      const current = postsRef.current.find((p) => p.id === id);
      if (!current || current.sponsored) return;
      const nextLiked = !current.isLiked;
      const nextCount = Math.max(0, current.likesCount + (nextLiked ? 1 : -1));
      patchPost(id, { isLiked: nextLiked, likesCount: nextCount });
      pendingLikeIdsRef.current.add(id);

      const token = await getToken();
      const endpoint = id > 0
        ? `${API_URL}/api/vroomki/${id}/like`
        : `${API_URL}/api/cars/${Math.abs(id)}/like`;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        patchPost(id, {
          isLiked: !!data.liked,
          likesCount: data.likesCount ?? nextCount,
        });
      } catch {
        localLikesRef.current.set(id, { isLiked: current.isLiked, likesCount: current.likesCount });
        patchPost(id, { isLiked: current.isLiked, likesCount: current.likesCount });
        Toast.show({ type: 'error', text1: 'Nie udało się polubić' });
      } finally {
        pendingLikeIdsRef.current.delete(id);
      }
    },
    [patchPost],
  );

  const handleCreateVroomki = useCallback(
    async (payload: VroomkiCreatePayload) => {
      const {
        caption,
        photos,
        video,
        carId,
        overlays,
        soundId: selectedSoundId,
        spotifyTrackId,
        audiusTrackId,
        deezerTrackId,
        itunesTrackId,
        useOriginalAudio,
        soundStartMs,
        photoDurationMs,
        clipStartMs,
        clipDurationMs,
      } = payload;
      const token = await getToken();
      if (!token) throw new Error('Brak tokenu');

      const commonFields: Record<string, string> = {
        caption,
        overlays: JSON.stringify(overlays ?? []),
        soundStartMs: String(soundStartMs ?? 0),
        photoDurationMs: String(photoDurationMs ?? 3000),
        clipStartMs: String(clipStartMs ?? 0),
        ...(clipDurationMs ? { clipDurationMs: String(clipDurationMs) } : {}),
        ...(carId ? { carId: String(carId) } : {}),
        ...(useOriginalAudio ? { useOriginalAudio: 'true' } : {}),
        ...(selectedSoundId ? { soundId: String(selectedSoundId) } : {}),
        ...(spotifyTrackId ? { spotifyTrackId } : {}),
        ...(audiusTrackId ? { audiusTrackId } : {}),
        ...(deezerTrackId ? { deezerTrackId } : {}),
        ...(itunesTrackId ? { itunesTrackId } : {}),
      };

      if (video) {
        const info = await FileSystem.getInfoAsync(video, { size: true } as any);
        const fileSize = Number((info as any)?.size ?? 0);
        const isPremium = !!settings.isPremium;
        const isAdmin = !!settings.isAdmin;
        const maxBytes = (isAdmin || isPremium) ? null : VROOMKI_FREE_VIDEO_MAX_BYTES;
        if (maxBytes !== null && fileSize > maxBytes) {
          throw new Error('Maksymalny rozmiar filmu VROOMKI bez Premium to 250MB');
        }
        Toast.show({ type: 'info', text1: 'Wysyłanie VROOMKI...', text2: 'Upload filmu działa w tle' });
        const ext = video.split('.').pop() ?? 'mp4';
        const result = await FileSystem.uploadAsync(`${API_URL}/api/vroomki`, video, {
          httpMethod: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'video',
          mimeType: `video/${ext}`,
          parameters: commonFields,
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        });
        const body = result.body ? JSON.parse(result.body) : null;
        if (result.status !== 200 && result.status !== 201) {
          if (body?.code === 'PREMIUM_REQUIRED_VIDEO_LIMIT') router.push('/premium' as any);
          throw new Error(body?.error ?? 'Błąd wysyłania filmu');
        }
        if (body) setPosts((prev) => [body, ...prev]);
        return;
      }

      const preparedPhotos = photos.length ? await prepareUploadImages(photos) : [];
      const form = new FormData();
      Object.entries(commonFields).forEach(([key, value]) => form.append(key, value));
      preparedPhotos.forEach((uri, i) => {
        form.append('photos', { uri, name: `vroomki_${i}.jpg`, type: 'image/jpeg' } as any);
      });
      const res = await fetch(`${API_URL}/api/vroomki`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Nie udało się opublikować VROOMKI');
      setPosts((prev) => [body, ...prev]);
    },
    [router, settings.isAdmin, settings.isPremium, setPosts],
  );

  const handleDeleteVroomki = useCallback(async (id: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    const token = await getToken();
    await fetch(`${API_URL}/api/vroomki/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [setPosts]);

  const handleReportVroomki = useCallback(async (post: VroomkiPost, reason: string) => {
    await reportContent({
      targetType: 'vroomki_post',
      targetId: post.id,
      reason,
      offenderUserId: post.author.id,
      details: `authorId=${post.author.id}`,
    });
  }, []);

  const applyBlockedIds = useCallback((ids: number[]) => {
    setBlockedIds(ids);
    setPosts((prev) => prev.filter((p) => !ids.includes(p.author.id)));
  }, [setPosts]);

  const handleBlockVroomkiAuthor = useCallback(
    (post: VroomkiPost) => {
      showBlockUserAlert(post.author.id, post.author.username, applyBlockedIds);
    },
    [applyBlockedIds],
  );

  const handleVroomkiView = useCallback(async (id: number, watchMs: number, completed: boolean) => {
    const current = postsRef.current.find((p) => p.id === id);
    if (!current || current.sponsored || id <= 0) return;
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/vroomki/${id}/view`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchMs, completed }),
      });
    } catch {
      // ignore
    }
  }, []);

  const handleVroomkiCommentAdded = useCallback((id: number) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, commentsCount: p.commentsCount + 1 } : p)));
  }, [setPosts]);

  const handleFollowVroomkiAuthor = useCallback(
    async (authorId: number) => {
      if (!authorId || authorId === myId) return;
      const current = postsRef.current.find((p) => p.author.id === authorId);
      const nextFollowing = !current?.isFollowingAuthor;
      setPosts((prev) =>
        prev.map((p) => (p.author.id === authorId ? { ...p, isFollowingAuthor: nextFollowing } : p)),
      );
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/api/follow/${authorId}`, {
          method: nextFollowing ? 'POST' : 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        Toast.show({
          type: 'success',
          text1: nextFollowing ? 'Obserwujesz autora' : 'Przestałeś obserwować',
        });
      } catch {
        setPosts((prev) =>
          prev.map((p) => (p.author.id === authorId ? { ...p, isFollowingAuthor: !nextFollowing } : p)),
        );
        Toast.show({ type: 'error', text1: 'Nie udało się zmienić obserwacji' });
      }
    },
    [myId, setPosts],
  );

  const filteredVroomki = vroomkiPosts.filter((p) => !blockedIds.includes(p.author.id));

  const focusOnPost = useCallback(async (postId: number) => {
    if (!Number.isFinite(postId)) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/${postId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const post: VroomkiPost = await res.json();
      const merged = mergeLocalState(post);
      focusedVroomkiRef.current = merged;
      setResolvedFocusPostId(merged.id);
      excludeIdsRef.current = [];
      setPosts((prev) => [merged, ...prev.filter((p) => p.id !== merged.id)]);
      await fetchVroomkiRef.current?.();
    } catch {
      // ignore
    }
  }, [mergeLocalState, setPosts]);

  return {
    myId,
    posts: filteredVroomki,
    focusPostId: resolvedFocusPostId,
    loadingC,
    refreshingC,
    loadingMoreC,
    hasMoreC,
    refresh,
    loadMore,
    like: handleLikeVroomki,
    create: handleCreateVroomki,
    remove: handleDeleteVroomki,
    report: handleReportVroomki,
    blockAuthor: handleBlockVroomkiAuthor,
    trackView: handleVroomkiView,
    markCommentAdded: handleVroomkiCommentAdded,
    followAuthor: handleFollowVroomkiAuthor,
    focusOnPost,
  };
}

