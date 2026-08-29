import { useCallback, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
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
import { apiRequest } from '../lib/api/client';
import { queryClient } from '../lib/query/client';
import { enqueueSocialOperation, subscribeSocialQueue } from '../lib/socialQueue';
import { uploadFileResumable } from '../lib/resumableUpload';

const PAGE_SIZE = 20;
/** Organic posts between sponsored slots (after the mandatory first ad). */
const VROOMKI_AD_EVERY = 5;
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

function createClientOperationId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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

type FeedPage = { items?: VroomkiPost[]; posts?: VroomkiPost[]; nextCursor: string | number | null; hasMore?: boolean };

export function useVroomkiFeed(
  initialVroomkiId?: number | null,
  soundId?: number | null,
  authorUserId?: number | null,
  searchQuery?: string | null,
) {
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
  const pendingLikeOperationsRef = useRef<Map<number, { operationId: string; previous: LocalLikeState }>>(new Map());
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
    const unsubscribe = subscribeVroomkiPublish((event) => {
      if (event.type !== 'success') return;
      const post = event.post;
      console.info('[useVroomkiFeed] publish success received', { postId: post.id });
      focusedVroomkiRef.current = post;
      setResolvedFocusPostId(post.id);
      setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
    });
    return () => { unsubscribe(); };
  }, [setPosts]);

  const normalizedSearchQuery = String(searchQuery ?? '').trim();

  const feedQueryKey = useCallback((cursor?: number) => [
    'vroomki', 'feed',
    Number.isFinite(authorUserId ?? NaN) ? authorUserId : 'all',
    Number.isFinite(soundId ?? NaN) ? soundId : 'all',
    normalizedSearchQuery,
    cursor || 'first',
  ] as const, [authorUserId, normalizedSearchQuery, soundId]);

  const fetchVroomki = useCallback(
    async (cursor?: number) => {
      if (!cursor) setLoadingC(true);
      const blocked = blockedIdsRef.current;
      try {
        const authorFilterId = Number.isFinite(authorUserId ?? NaN) ? authorUserId : null;
        const soundQuery = Number.isFinite(soundId ?? NaN) ? `&soundId=${soundId}` : '';
        const encodedSearch = encodeURIComponent(normalizedSearchQuery);
        const path = normalizedSearchQuery
          ? cursor
            ? `/vroomki/search?q=${encodedSearch}&cursor=${cursor}&limit=${PAGE_SIZE}`
            : `/vroomki/search?q=${encodedSearch}&limit=${PAGE_SIZE}`
          : authorFilterId
          ? `/vroomki/user/${authorFilterId}?limit=30`
          : Number.isFinite(soundId ?? NaN)
          ? `/vroomki?limit=${PAGE_SIZE}${cursor ? `&cursor=${cursor}` : ''}${soundQuery}`
          : cursor
          ? `/v2/vroomki?cursor=${cursor}&limit=${PAGE_SIZE}`
          : `/v2/vroomki?limit=${PAGE_SIZE}`;
        const key = feedQueryKey(cursor);
        const cached = !cursor ? queryClient.getQueryData<FeedPage | VroomkiPost[]>(key) : null;
        if (cached && postsRef.current.length === 0) {
          const cachedPosts = (Array.isArray(cached) ? cached : cached.items ?? cached.posts ?? [])
            .filter((post) => !blocked.includes(post.author.id))
            .map(mergeLocalState);
          setPosts(cachedPosts);
          setLoadingC(false);
        }
        const json = await queryClient.fetchQuery({
          queryKey: key,
          queryFn: () => apiRequest<FeedPage | VroomkiPost[]>(path, { priority: cursor ? 'prefetch' : 'visible' }),
          staleTime: 20_000,
        });
        const rawPosts: VroomkiPost[] = (Array.isArray(json) ? json : json.items ?? json.posts ?? []) as VroomkiPost[];
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
          && !Number.isFinite(soundId ?? NaN)
          && !settings.isPremium;

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
        setCarCursor(nextCursor ? Number(nextCursor) : null);
        setHasMoreC(!!nextCursor);
      } catch {
        Toast.show({ type: 'error', text1: 'Błąd ładowania VROOMKI' });
      } finally {
        setLoadingC(false);
        setRefreshingC(false);
        setLoadingMoreC(false);
      }
    },
    [authorUserId, feedQueryKey, mergeLocalState, normalizedSearchQuery, setPosts, settings.isPremium, soundId],
  );

  useEffect(() => {
    if (!settings.isPremium) return;
    adRotationRef.current = createAdRotationState();
    setPosts((previous) => previous.filter((post) => !post.sponsored));
  }, [setPosts, settings.isPremium]);

  fetchVroomkiRef.current = fetchVroomki;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      excludeIdsRef.current = [];
      adRotationRef.current = createAdRotationState();
      const focusId = initialVroomkiId ?? null;
      if (focusId && Number.isFinite(focusId)) {
        try {
          const post = await queryClient.fetchQuery({
            queryKey: ['vroomki', 'post', focusId],
            queryFn: ({ signal }) => apiRequest<VroomkiPost>(`/vroomki/${focusId}`, { signal, priority: 'critical' }),
            staleTime: 20_000,
          });
          if (!cancelled) {
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

  useEffect(() => subscribeSocialQueue((event) => {
    if (event.type !== 'vroomki.like.set') return;
    const postId = Number(event.entityKey.split(':')[1]);
    const pending = pendingLikeOperationsRef.current.get(postId);
    if (!pending || pending.operationId !== event.operationId) return;
    if (event.status === 'completed') {
      const response = event.response as { entity?: { isLiked?: boolean; likesCount?: number } } | undefined;
      if (response?.entity) patchPost(postId, response.entity);
      pendingLikeOperationsRef.current.delete(postId);
      pendingLikeIdsRef.current.delete(postId);
    } else if (event.status === 'failed') {
      patchPost(postId, pending.previous);
      pendingLikeOperationsRef.current.delete(postId);
      pendingLikeIdsRef.current.delete(postId);
      Toast.show({ type: 'error', text1: 'Nie udało się polubić', text2: 'Możesz spróbować ponownie później' });
    }
  }), [patchPost]);

  const handleLikeVroomki = useCallback(
    async (id: number) => {
      const current = postsRef.current.find((p) => p.id === id);
      if (!current || current.sponsored) return;
      const nextLiked = !current.isLiked;
      const nextCount = Math.max(0, current.likesCount + (nextLiked ? 1 : -1));
      patchPost(id, { isLiked: nextLiked, likesCount: nextCount });
      pendingLikeIdsRef.current.add(id);
      const requestId = createClientOperationId('vroomki-like');
      pendingLikeOperationsRef.current.set(id, {
        operationId: requestId,
        previous: { isLiked: current.isLiked, likesCount: current.likesCount },
      });
      try {
        if (!myId) throw new Error('Brak aktywnej sesji');
        await enqueueSocialOperation({
          userId: myId,
          type: 'vroomki.like.set',
          entityKey: `vroomki:${id}:like`,
          operationId: requestId,
          coalesce: true,
          request: id > 0 ? {
            path: `/v2/vroomki/${id}/like`,
            method: nextLiked ? 'PUT' : 'DELETE',
            invalidateKeys: [['vroomki', 'feed']],
          } : {
            path: `/cars/${Math.abs(id)}/like`,
            method: 'POST',
            invalidateKeys: [['vroomki', 'feed']],
          },
        });
      } catch {
        pendingLikeOperationsRef.current.delete(id);
        pendingLikeIdsRef.current.delete(id);
        localLikesRef.current.set(id, { isLiked: current.isLiked, likesCount: current.likesCount });
        patchPost(id, { isLiked: current.isLiked, likesCount: current.likesCount });
        Toast.show({ type: 'error', text1: 'Nie udało się polubić' });
      }
    },
    [myId, patchPost],
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
        const mimeType = ext.toLowerCase() === 'mov' ? 'video/quicktime' : `video/${ext.toLowerCase()}`;
        const asset = await uploadFileResumable({
          uri: video,
          fileName: `vroomki.${ext}`,
          mimeType,
        });
        const requestId = createClientOperationId('vroomki-create');
        const ack = await apiRequest<{ entity: VroomkiPost }>('/v2/vroomki', {
          method: 'POST',
          idempotencyKey: requestId,
          body: {
            ...commonFields,
            mediaAssetId: asset.id,
            useOriginalAudio: Boolean(useOriginalAudio),
          },
          priority: 'mutation',
        });
        if (ack.entity) setPosts((prev) => [ack.entity, ...prev.filter(post => post.id !== ack.entity.id)]);
        Toast.show({ type: 'success', text1: 'VROOMKA przyjęta', text2: 'Film jest przetwarzany w tle' });
        return;
      }

      const preparedPhotos = photos.length ? await prepareUploadImages(photos) : [];
      const form = new FormData();
      Object.entries(commonFields).forEach(([key, value]) => form.append(key, value));
      preparedPhotos.forEach((uri, i) => {
        form.append('photos', { uri, name: `vroomki_${i}.jpg`, type: 'image/jpeg' } as any);
      });
      const body = await apiRequest<VroomkiPost>('/vroomki', {
        method: 'POST',
        body: form,
      });
      setPosts((prev) => [body, ...prev]);
      await queryClient.invalidateQueries({ queryKey: ['vroomki', 'feed'] });
    },
    [settings.isAdmin, settings.isPremium, setPosts],
  );

  const handleDeleteVroomki = useCallback(async (id: number) => {
    const removed = postsRef.current.find((post) => post.id === id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
    try {
      await apiRequest(`/vroomki/${id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['vroomki', 'feed'] });
    } catch (error) {
      if (removed) setPosts((prev) => [removed, ...prev.filter(post => post.id !== id)]);
      throw error;
    }
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
      await apiRequest(`/vroomki/${id}/view`, {
        method: 'POST',
        body: { watchMs, completed },
        priority: 'background',
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
        if (!myId) throw new Error('Brak aktywnej sesji');
        await enqueueSocialOperation({
          userId: myId,
          type: 'follow',
          entityKey: `follow:${authorId}`,
          coalesce: true,
          request: {
            path: `/v2/social/users/${authorId}/follow`,
            method: nextFollowing ? 'PUT' : 'DELETE',
            invalidateKeys: [['profile', authorId, 'summary'], ['connections']],
          },
        });
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
      const post = await queryClient.fetchQuery({
        queryKey: ['vroomki', 'post', postId],
        queryFn: ({ signal }) => apiRequest<VroomkiPost>(`/vroomki/${postId}`, { signal, priority: 'critical' }),
        staleTime: 20_000,
      });
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

