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

const PAGE_SIZE = 20;
const getToken = () => AsyncStorage.getItem('token');
const FREE_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
const PREMIUM_VIDEO_MAX_BYTES = 120 * 1024 * 1024;

type LocalLikeState = {
  isLiked: boolean;
  likesCount: number;
};

export function useVroomkiFeed(initialVroomkiId?: number | null) {
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

  const fetchVroomki = useCallback(
    async (cursor?: number) => {
      if (!cursor) setLoadingC(true);
      const blocked = blockedIdsRef.current;
      try {
        const token = await getToken();
        const exclude = excludeIdsRef.current.join(',');
        const url = cursor
          ? `${API_URL}/api/vroomki?cursor=${cursor}&limit=${PAGE_SIZE}&exclude=${exclude}`
          : `${API_URL}/api/vroomki?limit=${PAGE_SIZE}`;
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
        const nextCursor = Array.isArray(json) ? null : json.nextCursor ?? null;
        if (cursor) {
          setPosts((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            return [...prev, ...mergedPosts.filter((p) => !existingIds.has(p.id))];
          });
        } else {
          setPosts(() => {
            let list = [...mergedPosts];
            const focused = focusedVroomkiRef.current;
            if (focused) {
              list = [focused, ...list.filter((p) => p.id !== focused.id)];
            }
            return list;
          });
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
    [mergeLocalState, setPosts],
  );

  fetchVroomkiRef.current = fetchVroomki;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      excludeIdsRef.current = [];
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
  }, [initialVroomkiId, mergeLocalState, setPosts]);

  const refresh = useCallback(() => {
    setRefreshingC(true);
    setHasMoreC(true);
    setCarCursor(null);
    excludeIdsRef.current = [];
    void fetchVroomki();
  }, [fetchVroomki]);

  const loadMore = useCallback(() => {
    if (!carCursor || loadingMoreC || !hasMoreC) return;
    setLoadingMoreC(true);
    void fetchVroomki(carCursor);
  }, [carCursor, loadingMoreC, hasMoreC, fetchVroomki]);

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
      if (!current) return;
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
    async (caption: string, photos: string[], video: string | null, carId: number | null) => {
      const token = await getToken();
      if (!token) throw new Error('Brak tokenu');
      if (video) {
        const info = await FileSystem.getInfoAsync(video, { size: true } as any);
        const fileSize = Number((info as any)?.size ?? 0);
        const isPremium = !!settings.isPremium;
        const isAdmin = !!settings.isAdmin;
        const maxBytes = isAdmin ? null : isPremium ? PREMIUM_VIDEO_MAX_BYTES : FREE_VIDEO_MAX_BYTES;
        if (maxBytes !== null && fileSize > maxBytes) {
          if (!isPremium && !isAdmin) {
            router.push('/premium' as any);
            throw new Error('Odblokuj Premium, aby wysyłać filmy do 120MB');
          }
          throw new Error('Maksymalny rozmiar filmu to 120MB');
        }
        Toast.show({ type: 'info', text1: 'Wysyłanie VROOMKI...', text2: 'Upload filmu działa w tle' });
        const ext = video.split('.').pop() ?? 'mp4';
        const result = await FileSystem.uploadAsync(`${API_URL}/api/vroomki`, video, {
          httpMethod: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'video',
          mimeType: `video/${ext}`,
          parameters: {
            caption,
            ...(carId ? { carId: String(carId) } : {}),
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        });
        const payload = result.body ? JSON.parse(result.body) : null;
        if (result.status !== 200 && result.status !== 201) {
          if (payload?.code === 'PREMIUM_REQUIRED_VIDEO_LIMIT') router.push('/premium' as any);
          throw new Error(payload?.error ?? 'Błąd wysyłania filmu');
        }
        if (payload) setPosts((prev) => [payload, ...prev]);
        return;
      }

      const preparedPhotos = photos.length ? await prepareUploadImages(photos) : [];
      const form = new FormData();
      form.append('caption', caption);
      if (carId) form.append('carId', String(carId));
      preparedPhotos.forEach((uri, i) => {
        form.append('photos', { uri, name: `vroomki_${i}.jpg`, type: 'image/jpeg' } as any);
      });
      const res = await fetch(`${API_URL}/api/vroomki`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? 'Nie udało się opublikować VROOMKI');
      setPosts((prev) => [payload, ...prev]);
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
  };
}

