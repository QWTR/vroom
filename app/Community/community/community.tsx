import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, FlatList, TouchableOpacity, Image, ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Pressable, StatusBar, ScrollView, Alert, Platform } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/ui/AppText';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import * as FileSystem        from 'expo-file-system/legacy';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { useSettings }        from '../../../contexts/SettingsContext';
import { API_URL }            from '../../../constants/config';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { RouteMiniMap }          from '../../../components/profile/RouteMiniMap';
import { RoutePreviewCard, parseRoutePostContent, type RoutePreviewData } from '../../../components/community/RoutePreviewCard';
import {
  CommunityScreenHeader,
  CommunitySearchBar,
  CommunitySearchBarInline,
  CommunitySegmentTabs,
} from '../../../components/community';
import { RouteLeaderboardModal } from '../../../components/modals/RouteLeaderboardModal';
import { useRouteLeaderboard }   from '../../../hooks/useRouteLeaderboard';
import {
  type Comment, type Post, type PublicRoute, type Tab,
  type DiscussionCategoryFilter,
  DISCUSSION_ALL_CATEGORIES,
  Avatar, PhotoViewer, LoadingView,
  renderDiscussionBody, searchMentionUsers, resolveMentionUserId,
  getSystemNewsSourceLabel, sanitizeSystemNewsContent,
  postMatchesDiscussionSearch, normalizeHashtag,
  ReactionChips, DISCUSSION_REACTION_EMOJIS,
} from './communityShared';
import { useKeyboardInset, modalKeyboardFooterPadding } from '../../../hooks/useKeyboardInset';
import { TabDyskusje, restoreDiscussionsScroll } from './TabDyskusje';
import {
  reportContent, showBlockUserAlert, syncBlockedUserIdsFromServer,
} from '../../../lib/ugcActions';
import { TabTrasy }    from './TabTrasy';
import { invalidateQuestTrack } from '../../../lib/questTrack';
import { SeasonSpotlightCard } from '../../../components/seasons/SeasonSpotlightCard';
import { apiRequest } from '../../../lib/api/client';
import { enqueueSocialOperation, subscribeSocialQueue } from '../../../lib/socialQueue';

const PAGE_SIZE = 20;
const POSTS_CACHE_PREFIX = 'vroom_discussions_first_page_v2';
const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
const FREE_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
const PREMIUM_VIDEO_MAX_BYTES = 120 * 1024 * 1024;
const COMMENT_POST_PREVIEW_CHARS = 420;

export default function CommunityScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ tab?: string; vroomkiId?: string; postId?: string; commentId?: string }>();
  const { theme, isDark } = useTheme();
  const { settings, updateSetting } = useSettings();
  const insets = useSafeAreaInsets();

  const [activeTab,    setActiveTab]    = useState<Tab>('dyskusje');
  const [myId,         setMyId]         = useState<number | null>(null);
  const [blockedIds,   setBlockedIds]   = useState<number[]>([]);
  const [search,       setSearch]       = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [discussionCategory, setDiscussionCategory] = useState<DiscussionCategoryFilter>(DISCUSSION_ALL_CATEGORIES);
  const categoryReadyRef = useRef(false);
  const handledNotificationPostRef = useRef<string | null>(null);

  // Posts
  const [posts,        setPosts]        = useState<Post[]>([]);
  const [loadingP,     setLoadingP]     = useState(true);
  const [refreshingP,  setRefreshingP]  = useState(false);
  const [postCursor,   setPostCursor]   = useState<number | null>(null);
  const [loadingMoreP, setLoadingMoreP] = useState(false);
  const [hasMoreP,     setHasMoreP]     = useState(true);
  const postsRef = useRef<Post[]>([]);
  const postsCacheKeyRef = useRef(`${POSTS_CACHE_PREFIX}:anonymous`);
  postsRef.current = posts;
  const freshPostsLoadedRef = useRef(false);
  const pendingPostStateRef = useRef(new Map<string, {
    operationId: string;
    kind: 'like' | 'repost';
    previous: Partial<Pick<Post, 'isLiked' | 'likesCount' | 'isReposted' | 'repostsCount'>>;
  }>());
  const pendingCommentLikeRef = useRef(new Map<number, {
    operationId: string;
    previous: Pick<Comment, 'isLiked' | 'likesCount'>;
  }>());

  // Routes
  const [routes,        setRoutes]        = useState<PublicRoute[]>([]);
  const [loadingR,      setLoadingR]      = useState(false);
  const [refreshingR,   setRefreshingR]   = useState(false);
  const [routeCursor,   setRouteCursor]   = useState<number | null>(null);
  const [loadingMoreR,  setLoadingMoreR]  = useState(false);
  const [hasMoreR,      setHasMoreR]      = useState(true);
  const routesInitialLoadAttemptedRef = useRef(false);

  // Leaderboard
  const { data: lbData, runsData: lbRunsData, loading: lbLoading, fetchLeaderboard, fetchRuns } = useRouteLeaderboard();
  const [lbRoute, setLbRoute] = useState<PublicRoute | null>(null);

  // Share route
  const [shareRoute,   setShareRoute]   = useState<PublicRoute | null>(null);
  const [shareConvs,   setShareConvs]   = useState<any[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSending, setShareSending] = useState<number | null>(null);
  const [shareSent,    setShareSent]    = useState<number[]>([]);

  // Comments
  const [commentPost,     setCommentPost]     = useState<Post | null>(null);
  const [comments,        setComments]        = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText,     setCommentText]     = useState('');
  const [commentPhotos,   setCommentPhotos]   = useState<string[]>([]);
  const [postingComment,  setPostingComment]  = useState(false);
  const [replyTo,         setReplyTo]         = useState<{ id: number; username: string } | null>(null);
  const [commentPhotoViewer, setCommentPhotoViewer] = useState(false);
  const [commentPhotoIdx,    setCommentPhotoIdx]    = useState(0);
  const [commentPhotoUris,   setCommentPhotoUris]   = useState<string[]>([]);
  const [commentMentionUsers, setCommentMentionUsers] = useState<{ id: number; username: string; avatarUrl: string | null }[]>([]);
  const [commentAuthorFollowing, setCommentAuthorFollowing] = useState(false);
  const [commentFollowLoading, setCommentFollowLoading] = useState(false);
  const [commentPostExpanded, setCommentPostExpanded] = useState(false);
  const [reactionPicker, setReactionPicker] = useState<{ type: 'post' | 'comment'; id: number } | null>(null);
  const commentMentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentListRef = useRef<FlatList<Comment>>(null);
  const commentKeyboardInset = useKeyboardInset(!!commentPost);

  useEffect(() => {
    if (!commentPost || commentKeyboardInset <= 0) return;
    const t = setTimeout(() => {
      commentListRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [commentPost, commentKeyboardInset]);

  const onCommentTextChange = (v: string) => {
    setCommentText(v);
    const match = v.match(/(?:^|\s)@([a-zA-Z0-9_.-]{1,32})$/);
    const q = match ? match[1] : null;
    if (commentMentionTimer.current) clearTimeout(commentMentionTimer.current);
    if (!q) {
      setCommentMentionUsers([]);
      return;
    }
    commentMentionTimer.current = setTimeout(async () => {
      const list = await searchMentionUsers(q);
      setCommentMentionUsers(list);
    }, 220);
  };

  const insertCommentMention = (username: string) => {
    setCommentText(prev => prev.replace(/@([a-zA-Z0-9_.-]*)$/, `@${username} `));
    setCommentMentionUsers([]);
  };

  useEffect(() => {
    void (async () => {
      try {
        const rawUser = await AsyncStorage.getItem('user');
        if (!rawUser) return;
        const user = JSON.parse(rawUser);
        const userId = Number(user.userId ?? user.id);
        if (!Number.isFinite(userId)) return;
        setMyId(userId);
        postsCacheKeyRef.current = `${POSTS_CACHE_PREFIX}:${userId}`;
        const rawCache = await AsyncStorage.getItem(postsCacheKeyRef.current);
        if (!rawCache || freshPostsLoadedRef.current) return;
        const cached = JSON.parse(rawCache);
        if (!Array.isArray(cached?.posts) || Date.now() - Number(cached?.at || 0) > 6 * 60 * 60 * 1000) return;
        setPosts(cached.posts);
        setPostCursor(cached.nextCursor ?? null);
        setHasMoreP(!!cached.nextCursor);
        setLoadingP(false);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (params.tab !== 'vroomki') return;
    router.replace({
      pathname: '/Community/vroomki',
      params: params.vroomkiId ? { vroomkiId: String(params.vroomkiId) } : {},
    } as any);
  }, [params.tab, params.vroomkiId, router]);

  // ── Fetch functions ──────────────────────────────────────
  const fetchPosts = useCallback(async (cursor?: number) => {
    try {
      const categoryParam = discussionCategory !== DISCUSSION_ALL_CATEGORIES
        ? `&category=${encodeURIComponent(discussionCategory)}`
        : '';
      const path = cursor
        ? `/posts?cursor=${cursor}&limit=${PAGE_SIZE}${categoryParam}`
        : `/posts?limit=${PAGE_SIZE}${categoryParam}`;
      const data = await apiRequest<{ posts?: Post[]; nextCursor?: number | null }>(path, {
        priority: cursor ? 'background' : 'visible',
      });
      const newPosts = data.posts ?? [];
      if (cursor) setPosts(prev => [...prev, ...newPosts]);
      else {
        freshPostsLoadedRef.current = true;
        setPosts(newPosts);
        if (
          discussionCategory === DISCUSSION_ALL_CATEGORIES
          && !postsCacheKeyRef.current.endsWith(':anonymous')
        ) {
          void AsyncStorage.setItem(postsCacheKeyRef.current, JSON.stringify({
            at: Date.now(),
            posts: newPosts,
            nextCursor: data.nextCursor ?? null,
          })).catch(() => {});
        }
      }
      setPostCursor(data.nextCursor ?? null);
      setHasMoreP(!!data.nextCursor);
    } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania postów' }); }
    finally { setLoadingP(false); setRefreshingP(false); setLoadingMoreP(false); }
  }, [discussionCategory]);

  const fetchRoutes = useCallback(async (cursor?: number) => {
    if (!cursor) setLoadingR(true);
    try {
      const path = cursor
        ? `/routes/community?cursor=${cursor}&limit=${PAGE_SIZE}&lite=1`
        : `/routes/community?limit=${PAGE_SIZE}&lite=1`;
      const json = await apiRequest<PublicRoute[] | { routes?: PublicRoute[]; nextCursor?: number | null }>(path, {
        priority: cursor ? 'background' : 'visible',
      });
      const newRoutes  = Array.isArray(json) ? json : json.routes ?? [];
      const nextCursor = Array.isArray(json) ? null : (json.nextCursor ?? null);
      if (cursor) setRoutes(prev => [...prev, ...newRoutes]);
      else        setRoutes(newRoutes);
      setRouteCursor(nextCursor);
      setHasMoreR(!!nextCursor);
    } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania tras' }); }
    finally { setLoadingR(false); setRefreshingR(false); setLoadingMoreR(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!postsRef.current.length) setLoadingP(true);
    setHasMoreP(true); setHasMoreR(true);
    fetchPosts();
    void syncBlockedUserIdsFromServer().then(setBlockedIds);
  }, [fetchPosts]));

  useEffect(() => {
    if (activeTab !== 'trasy' || routesInitialLoadAttemptedRef.current) return;
    routesInitialLoadAttemptedRef.current = true;
    void fetchRoutes();
  }, [activeTab, fetchRoutes]);

  const loadMorePosts  = useCallback(() => { if (!postCursor  || loadingMoreP || !hasMoreP) return; setLoadingMoreP(true);  fetchPosts(postCursor);   }, [postCursor,  loadingMoreP,  hasMoreP,  fetchPosts]);
  const loadMoreRoutes = useCallback(() => { if (!routeCursor || loadingMoreR || !hasMoreR) return; setLoadingMoreR(true); fetchRoutes(routeCursor); }, [routeCursor, loadingMoreR, hasMoreR, fetchRoutes]);

  const openLeaderboard = useCallback(async (route: PublicRoute) => {
    setLbRoute(route);
    await Promise.all([fetchLeaderboard(route.id), fetchRuns(route.id)]);
  }, [fetchLeaderboard, fetchRuns]);

  // ── Actions ──────────────────────────────────────────────
  useEffect(() => subscribeSocialQueue((event) => {
    if (event.type === 'post.comment.like.set') {
      const commentId = Number(event.entityKey.split(':')[1]);
      const pending = pendingCommentLikeRef.current.get(commentId);
      if (!pending || pending.operationId !== event.operationId) return;
      if (event.status === 'completed') pendingCommentLikeRef.current.delete(commentId);
      else if (event.status === 'failed') {
        setComments((previous) => previous.map((comment) => comment.id === commentId ? { ...comment, ...pending.previous } : comment));
        pendingCommentLikeRef.current.delete(commentId);
        Toast.show({ type: 'error', text1: 'Nie udało się polubić komentarza' });
      }
      return;
    }
    if (!['post.like.set', 'post.repost.set'].includes(event.type)) return;
    const postId = Number(event.entityKey.split(':')[1]);
    const kind = event.type === 'post.like.set' ? 'like' : 'repost';
    const pendingKey = `${postId}:${kind}`;
    const pending = pendingPostStateRef.current.get(pendingKey);
    if (!pending || pending.operationId !== event.operationId) return;
    if (event.status === 'completed') {
      pendingPostStateRef.current.delete(pendingKey);
    } else if (event.status === 'failed') {
      setPosts((previous) => previous.map((post) => post.id === postId ? { ...post, ...pending.previous } : post));
      pendingPostStateRef.current.delete(pendingKey);
      Toast.show({ type: 'error', text1: 'Nie udało się zapisać reakcji' });
    }
  }), []);

  const queuePostState = useCallback(async (id: number, kind: 'like' | 'repost') => {
    const current = postsRef.current.find((post) => post.id === id);
    if (!current || !myId) return;
    const enabled = kind === 'like' ? !current.isLiked : !current.isReposted;
    const previous = kind === 'like'
      ? { isLiked: current.isLiked, likesCount: current.likesCount }
      : { isReposted: current.isReposted, repostsCount: current.repostsCount };
    const operationId = `post-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const pendingKey = `${id}:${kind}`;
    pendingPostStateRef.current.set(pendingKey, { operationId, kind, previous });
    setPosts((items) => items.map((post) => {
      if (post.id !== id) return post;
      return kind === 'like'
        ? { ...post, isLiked: enabled, likesCount: Math.max(0, post.likesCount + (enabled ? 1 : -1)) }
        : { ...post, isReposted: enabled, repostsCount: Math.max(0, post.repostsCount + (enabled ? 1 : -1)) };
    }));
    try {
      await enqueueSocialOperation({
        userId: myId,
        type: `post.${kind}.set`,
        entityKey: `post:${id}:${kind}`,
        operationId,
        coalesce: true,
        request: {
          path: `/v2/posts/${id}/${kind}`,
          method: enabled ? 'PUT' : 'DELETE',
          invalidateKeys: [['community', 'posts']],
        },
      });
    } catch {
      pendingPostStateRef.current.delete(pendingKey);
      setPosts((items) => items.map((post) => post.id === id ? { ...post, ...previous } : post));
    }
  }, [myId]);

  const handleLikePost = useCallback((id: number) => queuePostState(id, 'like'), [queuePostState]);
  const handleRepost = useCallback((id: number) => queuePostState(id, 'repost'), [queuePostState]);

  const handleDeletePost = useCallback(async (id: number) => {
    const removed = postsRef.current.find((post) => post.id === id);
    setPosts(prev => prev.filter(p => p.id !== id));
    try {
      await apiRequest(`/posts/${id}`, { method: 'DELETE' });
    } catch {
      if (removed) setPosts((previous) => previous.some((post) => post.id === id) ? previous : [removed, ...previous]);
      Toast.show({ type: 'error', text1: 'Nie udało się usunąć posta' });
    }
  }, []);

  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editPostText, setEditPostText] = useState('');
  const [savingEditPost, setSavingEditPost] = useState(false);
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [savingEditComment, setSavingEditComment] = useState(false);

  const handleStartEditPost = useCallback((post: Post) => {
    setEditingPost(post);
    setEditPostText(post.content ?? '');
  }, []);

  const handleSaveEditPost = useCallback(async () => {
    if (!editingPost || savingEditPost) return;
    const content = editPostText.trim();
    if (!content && !(editingPost.photos?.length) && !(editingPost.videos?.length) && !editingPost.poll) {
      Toast.show({ type: 'error', text1: 'Treść nie może być pusta' });
      return;
    }
    setSavingEditPost(true);
    try {
      const updated = await apiRequest<Partial<Post>>(`/posts/${editingPost.id}`, {
        method: 'PATCH',
        body: { content },
      });
      setPosts(prev => prev.map(p => (
        p.id === editingPost.id
          ? { ...p, content: updated.content ?? content, editedAt: updated.editedAt ?? new Date().toISOString() }
          : p
      )));
      if (commentPost?.id === editingPost.id) {
        setCommentPost(prev => prev ? {
          ...prev,
          content: updated.content ?? content,
          editedAt: updated.editedAt ?? new Date().toISOString(),
        } : prev);
      }
      setEditingPost(null);
      Toast.show({ type: 'success', text1: 'Post zaktualizowany' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e?.message ?? 'Edycja nieudana' });
    } finally {
      setSavingEditPost(false);
    }
  }, [editingPost, editPostText, savingEditPost, commentPost?.id]);

  const handleStartEditComment = useCallback((comment: Comment) => {
    setEditingComment(comment);
    setEditCommentText(comment.content ?? '');
  }, []);

  const handleSaveEditComment = useCallback(async () => {
    if (!editingComment || savingEditComment) return;
    const content = editCommentText.trim();
    if (!content && !(editingComment.photos?.length)) {
      Toast.show({ type: 'error', text1: 'Treść nie może być pusta' });
      return;
    }
    setSavingEditComment(true);
    try {
      const updated = await apiRequest<Partial<Comment>>(`/posts/comments/${editingComment.id}`, {
        method: 'PATCH',
        body: { content },
      });
      setComments(prev => prev.map(c => (
        c.id === editingComment.id
          ? { ...c, content: updated.content ?? content, editedAt: updated.editedAt ?? new Date().toISOString() }
          : c
      )));
      setEditingComment(null);
      Toast.show({ type: 'success', text1: 'Komentarz zaktualizowany' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e?.message ?? 'Edycja nieudana' });
    } finally {
      setSavingEditComment(false);
    }
  }, [editingComment, editCommentText, savingEditComment]);

  const handleReportPost = useCallback(async (post: Post, reason: string) => {
    await reportContent({
      targetType: 'post',
      targetId: post.id,
      reason,
      offenderUserId: post.author.id,
      details: `authorId=${post.author.id}`,
    });
  }, []);

  const applyBlockedIds = useCallback((ids: number[]) => {
    setBlockedIds(ids);
    setPosts((prev) => prev.filter((p) => !ids.includes(p.author.id)));
    setComments((prev) => prev.filter((c) => !ids.includes(c.author.id)));
  }, []);

  const handleBlockPostAuthor = useCallback((post: Post) => {
    showBlockUserAlert(post.author.id, post.author.username, applyBlockedIds);
  }, [applyBlockedIds]);

  const handleBlockCommentAuthor = useCallback((authorId: number, username: string) => {
    showBlockUserAlert(authorId, username, applyBlockedIds);
  }, [applyBlockedIds]);

  const handleLikeRoute = useCallback(async (id: number) => {
    setRoutes(prev => prev.map(r => r.id !== id ? r : { ...r, isLiked: !r.isLiked, likesCount: r.isLiked ? r.likesCount - 1 : r.likesCount + 1 }));
    await apiRequest(`/routes/${id}/like`, { method: 'POST' });
  }, []);

  const handleNavigateRoute = useCallback(async (route: PublicRoute) => {
    let points = route.points;
    if (!points || points.length < 2) {
      const full = await apiRequest<{ points?: PublicRoute['points'] }>(`/routes/${route.id}`);
      points = full?.points;
    }
    if (!points || points.length < 2) {
      Toast.show({ type: 'error', text1: 'Brak geometrii trasy' });
      return;
    }
    await AsyncStorage.setItem('nav_route', JSON.stringify({ routeId: route.id, routeName: route.name, points, distance: route.distance }));
    router.push('/(tabs)/map' as any);
  }, [router]);

  const handleNavigateRoutePreview = useCallback(async (data: RoutePreviewData) => {
    let points = data.points;
    if (!points || points.length < 2) {
      const full = await apiRequest<{ points?: PublicRoute['points'] }>(`/routes/${data.routeId}`);
      points = full?.points ?? [];
    }
    if (!points || points.length < 2) {
      Toast.show({ type: 'error', text1: 'Brak geometrii trasy' });
      return;
    }
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId: data.routeId,
      routeName: data.name,
      points,
      distance: data.distance,
    }));
    router.push('/(tabs)/map' as any);
  }, [router]);

  const handlePost = async (
    text: string,
    photos: string[],
    video: string | null,
    category: Post['category'],
    poll?: { question: string; options: string[] } | null,
    title?: string,
  ) => {
    try {
      const token = await getToken();
      if (video) {
        const info = await FileSystem.getInfoAsync(video, { size: true } as any);
        const fileSize = Number((info as any)?.size ?? 0);
        const isPremium = !!settings.isPremium;
        const isAdmin = !!settings.isAdmin;
        const maxBytes = isAdmin ? null : (isPremium ? PREMIUM_VIDEO_MAX_BYTES : FREE_VIDEO_MAX_BYTES);
        if (maxBytes !== null && fileSize > maxBytes) {
          if (!isPremium && !isAdmin) {
            Toast.show({
              type: 'error',
              text1: 'Plik za duży',
              text2: 'Odblokuj Premium, aby wysyłać filmy do 120MB',
            });
            router.push('/premium' as any);
            return;
          }
          Toast.show({
            type: 'error',
            text1: 'Film za duży',
            text2: 'Maksymalnie 120MB dla Premium',
          });
          return;
        }

        Toast.show({
          type: 'info',
          text1: 'Wysyłanie filmu...',
          text2: 'Upload działa w tle, możesz wyjść z ekranu',
        });
        const bgVideo = video;
        const bgText = text;
        const bgPoll = poll;
        const bgTitle = title?.trim() || '';
        void (async () => {
          try {
            const ext = bgVideo.split('.').pop() ?? 'mp4';
            const result = await FileSystem.uploadAsync(`${API_URL}/api/posts`, bgVideo, {
              httpMethod: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              uploadType: FileSystem.FileSystemUploadType.MULTIPART,
              fieldName: 'video',
              mimeType: `video/${ext}`,
              parameters: {
                content: bgText,
                category,
                ...(bgTitle ? { title: bgTitle } : {}),
                ...(bgPoll ? { poll: JSON.stringify(bgPoll) } : {}),
              },
              sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
            });
            let payload: any = null;
            try {
              payload = result.body ? JSON.parse(result.body) : null;
            } catch {
              payload = null;
            }
            if (result.status !== 200 && result.status !== 201) {
              if (payload?.code === 'PREMIUM_REQUIRED_VIDEO_LIMIT') {
                Toast.show({
                  type: 'error',
                  text1: 'Plik za duży',
                  text2: 'Odblokuj Premium, aby wysyłać filmy do 120MB',
                });
                router.push('/premium' as any);
                return;
              }
              throw new Error(payload?.error ?? 'Błąd wysyłania filmu');
            }
            if (payload) {
              invalidateQuestTrack();
              setPosts(prev => {
                if (discussionCategory !== DISCUSSION_ALL_CATEGORIES && payload.category !== discussionCategory) {
                  return prev;
                }
                return [payload, ...prev];
              });
              Toast.show({
                type: 'success',
                text1: 'Film został opublikowany',
              });
            }
          } catch (err: any) {
            Toast.show({ type: 'error', text1: err?.message ?? 'Błąd wysyłania filmu' });
          }
        })();
        return;
      }
      const form  = new FormData();
      form.append('content', text);
      form.append('category', category);
      if (title?.trim()) form.append('title', title.trim());
      if (poll) form.append('poll', JSON.stringify(poll));
      photos.forEach((uri, i) => { const ext = uri.split('.').pop() ?? 'jpg'; form.append('photos', { uri, name: `p${i}.${ext}`, type: `image/${ext}` } as any); });
      const post = await apiRequest<Post>('/posts', { method: 'POST', body: form });
      invalidateQuestTrack();
      setPosts(prev => {
        if (discussionCategory !== DISCUSSION_ALL_CATEGORIES && post.category !== discussionCategory) {
          return prev;
        }
        return [post, ...prev];
      });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e?.message ?? 'Błąd wysyłania' });
    }
  };

  const handlePollVote = useCallback(async (postId: number, optionIdx: number) => {
    try {
      const data = await apiRequest<{ voteCounts: number[]; totalVotes: number; myVote: number }>(`/posts/${postId}/poll/vote`, {
        method: 'POST',
        body: { optionIdx },
      });
      let updated: Post['poll'] = null;
      setPosts(prev => prev.map(p => {
        if (p.id !== postId || !p.poll) return p;
        updated = {
          ...p.poll,
          voteCounts: data.voteCounts,
          totalVotes: data.totalVotes,
          myVote:     data.myVote,
        };
        return { ...p, poll: updated };
      }));
      invalidateQuestTrack();
      return updated;
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      return null;
    }
  }, []);

  const openShareRoute = async (route: PublicRoute) => {
    setShareRoute(route); setShareSent([]); setShareLoading(true);
    try {
      const json = await apiRequest<{ items?: any[] }>('/v2/chat/conversations?limit=30');
      setShareConvs(json.items ?? []);
    } catch {} finally { setShareLoading(false); }
  };

  const handleSendRouteToChat = async (convId: number) => {
    if (!shareRoute) return;
    setShareSending(convId);
    try {
      const content = JSON.stringify({ type: 'route', routeId: shareRoute.id, name: shareRoute.name, distance: shareRoute.distance, points: (shareRoute.points ?? []).slice(0, 50), isPublic: shareRoute.isPublic });
      if (!myId) throw new Error('Brak aktywnej sesji');
      await enqueueSocialOperation({
        userId: myId,
        type: 'chat.message.route',
        entityKey: `conversation:${convId}:messages`,
        request: {
          path: `/v2/chat/conversations/${convId}/messages`,
          method: 'POST',
          body: { content },
          invalidateKeys: [['chat', 'conversations'], ['chat', 'messages', convId]],
        },
      });
      setShareSent(prev => [...prev, convId]);
    } catch {} finally { setShareSending(null); }
  };

  const openComments = useCallback(async (post: Post) => {
    setCommentPost(post); setComments([]); setLoadingComments(true);
    setCommentPostExpanded(false);
    setCommentMentionUsers([]);
    setCommentAuthorFollowing(false);
    try {
      const [data, follow] = await Promise.all([
        apiRequest<Comment[]>(`/posts/${post.id}/comments`),
        post.author.id !== myId && myId
          ? apiRequest<{ isFollowing?: boolean }>(`/follow/status/${post.author.id}`, { priority: 'background' }).catch(() => null)
          : Promise.resolve(null),
      ]);
      setComments(Array.isArray(data) ? data : []);
      if (follow) setCommentAuthorFollowing(!!follow.isFollowing);
    } catch {} finally { setLoadingComments(false); }
  }, [myId]);

  const closeComments = useCallback(() => {
    Keyboard.dismiss();
    setCommentPost(null);
    setCommentPostExpanded(false);
    restoreDiscussionsScroll();
  }, []);

  const goToProfile = useCallback((userId: number) => {
    closeComments();
    router.push({ pathname: '/profile/[userId]', params: { userId: String(userId) } });
  }, [router, closeComments]);

  const handleCommentAuthorFollow = useCallback(async () => {
    if (!commentPost || commentPost.author.id === myId) return;
    setCommentFollowLoading(true);
    try {
      if (!myId) throw new Error('Brak aktywnej sesji');
      const previousFollowing = commentAuthorFollowing;
      const nextFollowing = !previousFollowing;
      setCommentAuthorFollowing(nextFollowing);
      try {
        await enqueueSocialOperation({
          userId: myId,
          type: 'follow',
          entityKey: `follow:${commentPost.author.id}`,
          coalesce: true,
          request: {
            path: `/v2/social/users/${commentPost.author.id}/follow`,
            method: nextFollowing ? 'PUT' : 'DELETE',
            invalidateKeys: [['profile', commentPost.author.id, 'summary'], ['connections']],
          },
        });
      } catch (error) {
        setCommentAuthorFollowing(previousFollowing);
        throw error;
      }
      Toast.show({ type: 'success', text1: nextFollowing ? 'Obserwujesz!' : 'Przestałeś obserwować' });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setCommentFollowLoading(false);
    }
  }, [commentPost, commentAuthorFollowing, myId]);

  const handlePostReact = useCallback(async (postId: number, emoji: string) => {
    const post = posts.find(p => p.id === postId);
    const hasMine = !!post?.reactions?.find(r => r.emoji === emoji)?.myReaction;
    try {
      const endpoint = hasMine
        ? `/posts/${postId}/reactions/${encodeURIComponent(emoji)}`
        : `/posts/${postId}/reactions`;
      const data = await apiRequest<{ reactions?: Post['reactions'] }>(endpoint, {
        method: hasMine ? 'DELETE' : 'POST',
        ...(hasMine ? {} : { body: { emoji } }),
      });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, reactions: data.reactions ?? [] } : p));
      setCommentPost(prev => (prev?.id === postId ? { ...prev, reactions: data.reactions ?? [] } : prev));
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    }
  }, [posts]);

  const handleCommentReact = useCallback(async (commentId: number, emoji: string) => {
    const comment = comments.find(c => c.id === commentId);
    const hasMine = !!comment?.reactions?.find(r => r.emoji === emoji)?.myReaction;
    try {
      const endpoint = hasMine
        ? `/posts/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`
        : `/posts/comments/${commentId}/reactions`;
      const data = await apiRequest<{ reactions?: Comment['reactions'] }>(endpoint, {
        method: hasMine ? 'DELETE' : 'POST',
        ...(hasMine ? {} : { body: { emoji } }),
      });
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, reactions: data.reactions ?? [] } : c));
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    }
  }, [comments]);

  const handleLikeComment = useCallback(async (commentId: number) => {
    const comment = comments.find(c => c.id === commentId);
    if (!comment || !myId) return;
    const nextLiked = !comment.isLiked;
    const nextCount = Math.max(0, (comment.likesCount ?? 0) + (nextLiked ? 1 : -1));
    setComments(prev => prev.map(c => c.id === commentId ? { ...c, isLiked: nextLiked, likesCount: nextCount } : c));
    const operationId = `post-comment-like-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    pendingCommentLikeRef.current.set(commentId, {
      operationId,
      previous: { isLiked: comment.isLiked, likesCount: comment.likesCount },
    });
    try {
      await enqueueSocialOperation({
        userId: myId,
        type: 'post.comment.like.set',
        entityKey: `comment:${commentId}:like`,
        operationId,
        coalesce: true,
        request: {
          path: `/v2/posts/comments/${commentId}/like`,
          method: nextLiked ? 'PUT' : 'DELETE',
          invalidateKeys: [['community', 'post-comments', commentPost?.id]],
        },
      });
    } catch {
      pendingCommentLikeRef.current.delete(commentId);
      setComments(prev => prev.map(c => c.id === commentId ? comment : c));
    }
  }, [commentPost?.id, comments, myId]);

  const handleSendComment = async () => {
    if (!commentText.trim() && commentPhotos.length === 0) return;
    if (!commentPost) return;
    setPostingComment(true);
    try {
      const form  = new FormData();
      form.append('content', commentText.trim());
      if (replyTo) form.append('replyToId', String(replyTo.id));
      commentPhotos.forEach((uri, i) => { const ext = uri.split('.').pop() ?? 'jpg'; form.append('photos', { uri, name: `cp${i}.${ext}`, type: `image/${ext}` } as any); });
      const comment = await apiRequest<Comment>(`/posts/${commentPost.id}/comments`, { method: 'POST', body: form });
      setComments(prev => [...prev, comment]);
      setCommentText(''); setCommentPhotos([]); setReplyTo(null);
      setPosts(prev => prev.map(p => p.id === commentPost.id ? { ...p, commentsCount: p.commentsCount + 1 } : p));
    } catch {} finally { setPostingComment(false); }
  };

  const pickCommentPhoto = async () => {
    if (commentPhotos.length >= 2) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.82,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 2 - commentPhotos.length),
    });
    if (!r.canceled && r.assets?.length) {
      setCommentPhotos(prev => [...prev, ...r.assets.map((a) => a.uri)].slice(0, 2));
    }
  };

  useFocusEffect(useCallback(() => {
    (async () => {
      const legacyPostId = await AsyncStorage.getItem('open_post_id');
      const postId = Array.isArray(params.postId) ? params.postId[0] : params.postId || legacyPostId;
      if (!postId) return;
      const navigationKey = `${postId}:${String(params.commentId || '')}`;
      if (handledNotificationPostRef.current === navigationKey) return;
      handledNotificationPostRef.current = navigationKey;
      await AsyncStorage.removeItem('open_post_id');
      const existing = posts.find(p => p.id === Number(postId));
      setActiveTab('dyskusje');
      if (existing) { openComments(existing); return; }
      try {
        openComments(await apiRequest<Post>(`/posts/${postId}`));
      } catch {
        Toast.show({ type: 'info', text1: 'Ta treść nie jest już dostępna' });
      }
    })();
  }, [params.postId, params.commentId, posts, openComments]));

  // ── Filtered lists ───────────────────────────────────────
  const visiblePosts = posts.filter((p) => !blockedIds.includes(p.author.id));
  const handleHashtagPress = useCallback((rawTag: string) => {
    const tag = normalizeHashtag(rawTag);
    if (!tag) return;
    closeComments();
    setSearch(tag);
    setSearchActive(true);
    setActiveTab('dyskusje');
  }, [closeComments]);

  const filteredPosts  = search.trim()
    ? visiblePosts.filter((p) => {
        const q = search.trim();
        if (q.startsWith('#') && q.length > 1) {
          return postMatchesDiscussionSearch(p.content, q);
        }
        const ql = q.toLowerCase();
        return p.content.toLowerCase().includes(ql)
          || (p.title || '').toLowerCase().includes(ql)
          || (p.excerpt || '').toLowerCase().includes(ql)
          || p.author.username.toLowerCase().includes(ql);
      })
    : visiblePosts;
  useEffect(() => {
    if (!categoryReadyRef.current) {
      categoryReadyRef.current = true;
      return;
    }
    setLoadingP(true);
    setHasMoreP(true);
    setPostCursor(null);
    fetchPosts();
  }, [discussionCategory, fetchPosts]);

  const selectDiscussionCategory = useCallback((category: DiscussionCategoryFilter) => {
    setDiscussionCategory(category);
  }, []);
  const filteredRoutes = search.trim() ? routes.filter(r => r.name.toLowerCase().includes(search.toLowerCase())     || r.author.username.toLowerCase().includes(search.toLowerCase())) : routes;

  const modalBottomPadding = Math.max(insets.bottom, 12);
  const commentInputBottomPad = Platform.OS === 'ios'
    ? modalKeyboardFooterPadding(
        commentKeyboardInset,
        modalBottomPadding,
        { parentHasKeyboardAvoiding: true },
      )
    : modalBottomPadding;
  const commentPostBody = useMemo(() => {
    if (!commentPost?.content) return '';
    const isSystemNews = commentPost.postType === 'system_news' || !!commentPost.isSystem;
    return isSystemNews ? sanitizeSystemNewsContent(commentPost.content) : commentPost.content;
  }, [commentPost]);
  const shouldCollapseCommentPost = commentPostBody.length > COMMENT_POST_PREVIEW_CHARS;
  const visibleCommentPostBody = shouldCollapseCommentPost && !commentPostExpanded
    ? `${commentPostBody.slice(0, COMMENT_POST_PREVIEW_CHARS).trim()}...`
    : commentPostBody;

  // ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {searchActive ? (
        <View style={{
          paddingHorizontal: 16,
          paddingTop: Platform.OS === 'ios'
            ? insets.top + 8
            : Math.max((StatusBar.currentHeight ?? 0) + 8, 12),
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          backgroundColor: theme.surface,
        }}>
          <CommunitySearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Szukaj, @nick lub #tag..."
            autoFocus
            onClear={() => { setSearch(''); setSearchActive(false); }}
          />
        </View>
      ) : (
        <CommunityScreenHeader
          title="DYSKUSJE"
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                onPress={async () => {
                  const next = !settings.notifDiscussionPosts;
                  await updateSetting('notifDiscussionPosts', next);
                  Toast.show({
                    type: next ? 'success' : 'info',
                    text1: next ? 'Dyskusje: powiadomienia o nowych postach' : 'Dyskusje: powiadomienia wyciszone',
                  });
                }}
                style={{ padding: 4 }}
              >
                <MaterialIcons
                  name={settings.notifDiscussionPosts ? 'notifications-active' : 'notifications-off'}
                  size={22}
                  color={settings.notifDiscussionPosts ? theme.primary : theme.textDim}
                />
              </TouchableOpacity>
              <CommunitySearchBarInline
                expanded={false}
                onExpand={() => setSearchActive(true)}
                onCollapse={() => { setSearch(''); setSearchActive(false); }}
                value={search}
                onChangeText={setSearch}
                placeholder="Szukaj, @nick lub #tag..."
              />
            </View>
          }
        />
      )}

      <CommunitySegmentTabs
        tabs={[
          { key: 'dyskusje', label: 'DYSKUSJE', icon: 'forum' },
          { key: 'trasy',    label: 'TRASY',    icon: 'map' },
        ]}
        activeKey={activeTab}
        onChange={key => setActiveTab(key as Tab)}
      />

      <SeasonSpotlightCard active={isFocused} compact />

      {/* ══ DYSKUSJE ══════════════════════════════════════════ */}
      {activeTab === 'dyskusje' && (
        <View style={{ flex: 1 }}>
          {loadingP ? <LoadingView /> : (
            <TabDyskusje
              posts={filteredPosts} myId={myId} loadingMoreP={loadingMoreP}
              refreshingP={refreshingP} hasMoreP={hasMoreP}
              onLike={handleLikePost} onRepost={handleRepost} onComment={openComments}
              onDelete={handleDeletePost} onEdit={handleStartEditPost} onPost={handlePost} onPollVote={handlePollVote}
              onReport={handleReportPost}
              onBlock={handleBlockPostAuthor}
              onReact={handlePostReact}
              onOpenReactionPicker={(post) => setReactionPicker({ type: 'post', id: post.id })}
              onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
              onHashtagPress={handleHashtagPress}
              onNavigateRoute={handleNavigateRoutePreview}
              selectedCategory={discussionCategory}
              onSelectCategory={selectDiscussionCategory}
              onRefresh={() => { setRefreshingP(true); setHasMoreP(true); fetchPosts(); }}
              onLoadMore={loadMorePosts} bottomInset={insets.bottom}
              isPremium={!!settings.isPremium}
              isAdmin={!!settings.isAdmin}
              onUpgradePremium={() => router.push('/premium' as any)}
            />
          )}
        </View>
      )}

      {/* ══ TRASY ═════════════════════════════════════════════ */}
      {activeTab === 'trasy' && (
        <View style={{ flex: 1 }}>
        {loadingR ? <LoadingView /> :
        <TabTrasy
          routes={filteredRoutes} myId={myId} loadingMoreR={loadingMoreR}
          refreshingR={refreshingR} hasMoreR={hasMoreR}
          onLike={handleLikeRoute} onNavigate={handleNavigateRoute}
          onShare={openShareRoute} onLeaderboard={openLeaderboard}
          onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
          onRefresh={() => { setRefreshingR(true); setHasMoreR(true); fetchRoutes(); }}
          onLoadMore={loadMoreRoutes} bottomInset={insets.bottom}
        />
        }
        </View>
      )}

      {/* ══ MODAL KOMENTARZY ══════════════════════════════════ */}
      <Modal
        visible={!!commentPost}
        animationType="slide"
        transparent={false}
        statusBarTranslucent={false}
        onRequestClose={closeComments}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['left', 'right', 'bottom']}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingTop: Platform.OS === 'ios'
              ? insets.top + 8
              : Math.max((StatusBar.currentHeight ?? 0) + 8, 10),
            paddingBottom: 10,
            borderBottomWidth: 1, borderBottomColor: theme.border,
          }}>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}
              onPress={closeComments}
            >
              <MaterialIcons name="arrow-back" size={20} color={theme.text} />
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 12, letterSpacing: 1 }}>POST</Text>
            <View style={{ width: 38 }} />
          </View>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            enabled={Platform.OS === 'ios'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
          >
          <View style={{ flex: 1, backgroundColor: theme.surface }}>
            <View style={{ flex: 1 }}>
              {/* Post i komentarze sa jedna lista, zeby dlugi post nie blokowal czytania odpowiedzi. */}
              {loadingComments ? (
                <ActivityIndicator color="#e33835" style={{ margin: 30 }} />
              ) : (
                <FlatList
                  ref={commentListRef}
                  data={comments}
                  keyExtractor={c => String(c.id)}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
                  showsVerticalScrollIndicator={true}
                  ListHeaderComponent={commentPost ? (
                    <>
                      <View style={{
                        flexDirection: 'row', gap: 10, marginBottom: 12,
                        backgroundColor: theme.surface2, borderRadius: 14, padding: 10,
                        borderWidth: 1, borderColor: theme.border,
                      }}>
                        <TouchableOpacity onPress={() => goToProfile(commentPost.author.id)}>
                          <Avatar user={commentPost.author} size={30} />
                        </TouchableOpacity>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                            <TouchableOpacity onPress={() => goToProfile(commentPost.author.id)}>
                              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 12 }}>{commentPost.author.username}</Text>
                            </TouchableOpacity>
                            {commentPost.author.id !== myId && myId != null && (
                              <TouchableOpacity
                                onPress={handleCommentAuthorFollow}
                                disabled={commentFollowLoading}
                                style={{
                                  paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
                                  backgroundColor: commentAuthorFollowing ? theme.surface : '#e33835',
                                  borderWidth: 1, borderColor: commentAuthorFollowing ? theme.border : '#e33835',
                                }}
                              >
                                {commentFollowLoading
                                  ? <ActivityIndicator size="small" color={commentAuthorFollowing ? theme.textDim : '#fff'} />
                                  : (
                                    <Text style={{
                                      fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700',
                                      color: commentAuthorFollowing ? theme.textDim : '#fff',
                                    }}>
                                      {commentAuthorFollowing ? 'OBSERWUJESZ' : 'OBSERWUJ'}
                                    </Text>
                                  )
                                }
                              </TouchableOpacity>
                            )}
                          </View>
                          {(() => {
                            const routePreview = parseRoutePostContent(commentPost.content);
                            const isSystemNews = commentPost.postType === 'system_news' || !!commentPost.isSystem;
                            if (routePreview) {
                              return (
                                <RoutePreviewCard
                                  data={routePreview}
                                  onNavigate={handleNavigateRoutePreview}
                                  fullWidth
                                />
                              );
                            }
                            if (commentPostBody.length > 0 || commentPost.title) {
                              return (
                                <View style={{ gap: 8 }}>
                                  {isSystemNews && (
                                    <View style={{
                                      alignSelf: 'flex-start',
                                      borderRadius: 999,
                                      backgroundColor: '#e33835',
                                      paddingHorizontal: 9,
                                      paddingVertical: 4,
                                    }}>
                                      <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>
                                        {`ZRODLO: ${getSystemNewsSourceLabel(commentPost)}`}
                                      </Text>
                                    </View>
                                  )}
                                  {!!commentPost.title && (
                                    <Text style={{ color: theme.text, fontSize: 17, lineHeight: 23, fontWeight: '800' }}>
                                      {commentPost.title}
                                    </Text>
                                  )}
                                  {!!visibleCommentPostBody && (
                                    <Text style={{ fontSize: 15, lineHeight: 22 }}>
                                      {renderDiscussionBody(
                                        visibleCommentPostBody,
                                        theme,
                                        {
                                          textColor: theme.textDim,
                                          onMentionPress: async (username) => {
                                            const uid = await resolveMentionUserId(username);
                                            if (uid) goToProfile(uid);
                                          },
                                          onHashtagPress: handleHashtagPress,
                                        },
                                      )}
                                    </Text>
                                  )}
                                  {shouldCollapseCommentPost && (
                                    <TouchableOpacity
                                      onPress={() => setCommentPostExpanded(v => !v)}
                                      activeOpacity={0.85}
                                      style={{
                                        alignSelf: 'flex-start',
                                        paddingHorizontal: 10,
                                        paddingVertical: 7,
                                        borderRadius: 999,
                                        backgroundColor: '#e3383515',
                                        borderWidth: 1,
                                        borderColor: '#e3383530',
                                      }}
                                    >
                                      <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 12, fontWeight: '800' }}>
                                        {commentPostExpanded ? 'ZWIN POST' : 'POKAZ CALY POST'}
                                      </Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              );
                            }
                            return null;
                          })()}
                          {commentPost.photos?.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                              {commentPost.photos.map((uri, i) => (
                                <TouchableOpacity
                                  key={`${uri}-${i}`}
                                  onPress={() => {
                                    setCommentPhotoUris(commentPost.photos);
                                    setCommentPhotoIdx(i);
                                    setCommentPhotoViewer(true);
                                  }}
                                >
                                  <Image
                                    source={{ uri }}
                                    style={{ width: 72, height: 72, borderRadius: 10 }}
                                    resizeMode="cover"
                                  />
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                          {!!commentPost.reactions?.length && (
                            <ReactionChips
                              reactions={commentPost.reactions}
                              onToggle={(emoji) => handlePostReact(commentPost.id, emoji)}
                            />
                          )}
                        </View>
                      </View>

                      <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 12 }} />
                      <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>
                        KOMENTARZE
                      </Text>
                    </>
                  ) : null}
                  renderItem={({ item }) => (
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                      <TouchableOpacity onPress={() => goToProfile(item.author.id)}>
                        <Avatar user={item.author} size={32} />
                      </TouchableOpacity>
                      <View style={{
                        flex: 1, backgroundColor: theme.surface2,
                        borderRadius: 14, padding: 10,
                        borderWidth: 1, borderColor: theme.border,
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          <TouchableOpacity onPress={() => goToProfile(item.author.id)}>
                            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 12, fontWeight: '700' }}>{item.author.username}</Text>
                          </TouchableOpacity>
                          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12 }}>
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: pl })}
                            {item.editedAt ? ' · edytowano' : ''}
                          </Text>
                          {item.author.id === myId ? (
                            <TouchableOpacity
                              onPress={() => {
                                Alert.alert('Twój komentarz', undefined, [
                                  { text: 'Anuluj', style: 'cancel' },
                                  { text: 'Edytuj', onPress: () => handleStartEditComment(item) },
                                ]);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <MaterialIcons name="more-horiz" size={16} color={theme.textDim} />
                            </TouchableOpacity>
                          ) : item.author.id !== myId && (
                            <TouchableOpacity
                              onPress={() => {
                                Alert.alert(`@${item.author.username}`, undefined, [
                                  { text: 'Anuluj', style: 'cancel' },
                                  { text: 'Zgłoś', onPress: () => void reportContent({
                                    targetType: 'post_comment',
                                    targetId: item.id,
                                    reason: 'other',
                                    offenderUserId: item.author.id,
                                    details: `authorId=${item.author.id}`,
                                  })},
                                  { text: 'Zablokuj', style: 'destructive', onPress: () => handleBlockCommentAuthor(item.author.id, item.author.username) },
                                ]);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <MaterialIcons name="more-horiz" size={16} color={theme.textDim} />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            onPress={() => setReplyTo({ id: item.id, username: item.author.username })}
                          >
                            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 12 }}>↩ odpowiedz</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleLikeComment(item.id)}>
                            <MaterialCommunityIcons
                              name={item.isLiked ? 'heart' : 'heart-outline'}
                              size={14}
                              color={item.isLiked ? '#e33835' : theme.textDim}
                            />
                          </TouchableOpacity>
                          {(item.likesCount ?? 0) > 0 && (
                            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12 }}>{item.likesCount}</Text>
                          )}
                          <TouchableOpacity onPress={() => setReactionPicker({ type: 'comment', id: item.id })}>
                            <Text style={{ fontSize: 12 }}>😀</Text>
                          </TouchableOpacity>
                        </View>
                        {item.replyTo && (
                          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e3383555', fontSize: 12, marginBottom: 4 }}>
                            ↩ @{item.replyTo.username}
                          </Text>
                        )}
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onLongPress={() => setReactionPicker({ type: 'comment', id: item.id })}
                          delayLongPress={400}
                        >
                          <Text style={{ fontSize: 13, lineHeight: 19 }}>
                            {renderDiscussionBody(item.content, theme, {
                              onMentionPress: async (username) => {
                                const uid = await resolveMentionUserId(username);
                                if (uid) goToProfile(uid);
                              },
                              onHashtagPress: handleHashtagPress,
                            })}
                          </Text>
                        </TouchableOpacity>
                        <ReactionChips
                          reactions={item.reactions}
                          onToggle={(emoji) => handleCommentReact(item.id, emoji)}
                        />
                        {item.photos?.length > 0 && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {item.photos.map((uri: string, i: number) => (
                              <TouchableOpacity
                                key={i}
                                onPress={() => { setCommentPhotoUris(item.photos); setCommentPhotoIdx(i); setCommentPhotoViewer(true); }}
                              >
                                <Image source={{ uri }} style={{ width: 72, height: 72, borderRadius: 10 }} resizeMode="cover" />
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                    </View>
                  )}
                  ListEmptyComponent={
                    <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
                      BRAK KOMENTARZY · BĄDŹ PIERWSZY
                    </Text>
                  }
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                />
              )}
            </View>

            {/* Input komentarza — sticky footer nad klawiaturą */}
            <View style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: commentInputBottomPad,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              backgroundColor: theme.surface,
            }}>
              {replyTo && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: '#e3383515', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 7,
                  marginBottom: 8, borderWidth: 1, borderColor: '#e3383530',
                }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 12 }}>↩ @{replyTo.username}</Text>
                  <TouchableOpacity onPress={() => setReplyTo(null)}>
                    <MaterialIcons name="close" size={14} color={theme.textDim} />
                  </TouchableOpacity>
                </View>
              )}

              {commentPhotos.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  {commentPhotos.map((uri, i) => (
                    <View key={i} style={{ position: 'relative' }}>
                      <TouchableOpacity onPress={() => { setCommentPhotoUris(commentPhotos); setCommentPhotoIdx(i); setCommentPhotoViewer(true); }}>
                        <Image source={{ uri }} style={{ width: 58, height: 58, borderRadius: 10 }} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#e33835', borderRadius: 9, width: 17, height: 17, justifyContent: 'center', alignItems: 'center' }}
                        onPress={() => setCommentPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      >
                        <MaterialIcons name="close" size={11} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {commentMentionUsers.length > 0 && (
                <View style={{
                  marginBottom: 8, maxHeight: 120, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
                  backgroundColor: theme.surface2, overflow: 'hidden',
                }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {commentMentionUsers.map(u => (
                      <TouchableOpacity
                        key={u.id}
                        onPress={() => insertCommentMention(u.username)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}
                      >
                        <Avatar user={u} size={28} />
                        <Text style={{ color: theme.text, fontSize: 13 }}>{u.username}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <TouchableOpacity onPress={pickCommentPhoto} disabled={commentPhotos.length >= 2}>
                  <MaterialIcons name="add-photo-alternate" size={22} color={commentPhotos.length >= 2 ? theme.textDim : '#e33835'} />
                </TouchableOpacity>
                <TextInput
                  style={{
                    flex: 1, backgroundColor: theme.surface2, borderRadius: 20,
                    paddingHorizontal: 14, paddingVertical: 10,
                    color: theme.text, fontSize: 13, maxHeight: 80,
                    borderWidth: 1, borderColor: theme.border,
                  }}
                  value={commentText}
                  onChangeText={onCommentTextChange}
                  onBlur={() => setTimeout(() => setCommentMentionUsers([]), 200)}
                  placeholder={replyTo ? `Odpowiedz @${replyTo.username}...` : 'Napisz komentarz...'}
                  placeholderTextColor={theme.textDim}
                  multiline
                  blurOnSubmit={false}
                  onFocus={() => {
                    setTimeout(() => commentListRef.current?.scrollToEnd({ animated: true }), 280);
                  }}
                />
                <TouchableOpacity
                  style={[{
                    width: 38, height: 38, borderRadius: 19,
                    backgroundColor: '#e33835',
                    justifyContent: 'center', alignItems: 'center',
                  }, (!commentText.trim() && commentPhotos.length === 0) && { opacity: 0.3 }]}
                  onPress={handleSendComment}
                  disabled={(!commentText.trim() && commentPhotos.length === 0) || postingComment}
                >
                  {postingComment
                    ? <ActivityIndicator size={14} color="#fff" />
                    : <MaterialIcons name="send" size={16} color="#fff" />
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
          {commentPhotoViewer && (
            <PhotoViewer
              photos={commentPhotoUris}
              initialIndex={commentPhotoIdx}
              visible={commentPhotoViewer}
              onClose={() => setCommentPhotoViewer(false)}
              useOverlay
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* ══ MODAL WYŚLIJ TRASĘ ════════════════════════════════ */}
      <Modal
        visible={!!shareRoute}
        animationType="slide"
        transparent
        onRequestClose={() => setShareRoute(null)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShareRoute(null)} />
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            maxHeight: '82%', borderTopWidth: 1, borderColor: theme.border2,
            paddingHorizontal: 16, paddingBottom: modalBottomPadding,
          }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderColor: theme.border }}>
              <MaterialCommunityIcons name="map-marker-path" size={18} color="#e33835" />
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: theme.text, letterSpacing: 1, flex: 1 }}>WYŚLIJ TRASĘ</Text>
              <TouchableOpacity style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }} onPress={() => setShareRoute(null)}>
                <MaterialIcons name="close" size={16} color={theme.textDim} />
              </TouchableOpacity>
            </View>
            {shareRoute && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface2, borderRadius: 14, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: theme.border }}>
                <View style={{ borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
                  <RouteMiniMap points={shareRoute.points} width={80} height={52} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{shareRoute.name}</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 3 }}>{shareRoute.distance.toFixed(1)} km · {shareRoute.points.length} pkt</Text>
                </View>
              </View>
            )}
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1, marginBottom: 10 }}>WYBIERZ ROZMOWĘ</Text>
            {shareLoading ? (
              <ActivityIndicator color="#e33835" style={{ marginVertical: 30 }} />
            ) : (
              <FlatList
                data={shareConvs} keyExtractor={c => String(c.id)}
                style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={<Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, textAlign: 'center', marginTop: 30 }}>Brak rozmów</Text>}
                renderItem={({ item: conv }) => {
                  const other  = conv.participants?.find((p: any) => p.id !== myId);
                  const name   = conv.isGroup ? conv.name : other?.username ?? '?';
                  const avatar = conv.isGroup ? conv.avatarUrl : other?.avatarUrl ?? null;
                  const isSent = shareSent.includes(conv.id);
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.border }}>
                      {avatar
                        ? <Image source={{ uri: avatar }} style={{ width: 42, height: 42, borderRadius: 21 }} />
                        : <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#e3383518', borderWidth: 1, borderColor: '#e3383530', justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={{ color: '#e33835', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{name.slice(0, 2).toUpperCase()}</Text>
                          </View>
                      }
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '600' }} numberOfLines={1}>{name}</Text>
                        {conv.isGroup && <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 2 }}>{conv.participants?.length} uczestników</Text>}
                      </View>
                      <TouchableOpacity
                        style={[{
                          flexDirection: 'row', alignItems: 'center', gap: 5,
                          borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
                        }, isSent
                          ? { backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92630' }
                          : { backgroundColor: '#e33835' }
                        ]}
                        onPress={() => !isSent && handleSendRouteToChat(conv.id)}
                        disabled={isSent || shareSending === conv.id}
                      >
                        {shareSending === conv.id
                          ? <ActivityIndicator size={14} color="#fff" />
                          : isSent
                            ? <><MaterialIcons name="check" size={13} color="#4de926" /><Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#4de926', fontWeight: '700' }}>WYSŁANO</Text></>
                            : <><MaterialIcons name="send" size={13} color="#fff" /><Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#fff', fontWeight: '700' }}>WYŚLIJ</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ══ LEADERBOARD ═══════════════════════════════════════ */}
      <RouteLeaderboardModal
        visible={lbRoute !== null}
        routeId={lbRoute?.id ?? null}
        routeName={lbRoute?.name ?? ''}
        data={lbData} runsData={lbRunsData} loading={lbLoading}
        onClose={() => setLbRoute(null)}
      />

      {/* ══ PICKER REAKCJI ════════════════════════════════════ */}
      <Modal
        visible={!!reactionPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionPicker(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}
          onPress={() => setReactionPicker(null)}
        >
          <Pressable
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              paddingHorizontal: 20, paddingTop: 16,
              paddingBottom: modalBottomPadding + 12,
              borderWidth: 1, borderColor: theme.border2,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1, marginBottom: 14, textAlign: 'center' }}>
              WYBIERZ REAKCJĘ
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap', gap: 8 }}>
              {DISCUSSION_REACTION_EMOJIS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => {
                    if (!reactionPicker) return;
                    if (reactionPicker.type === 'post') handlePostReact(reactionPicker.id, emoji);
                    else handleCommentReact(reactionPicker.id, emoji);
                    setReactionPicker(null);
                  }}
                  style={{
                    width: 48, height: 48, borderRadius: 24,
                    backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: theme.border,
                  }}
                >
                  <Text style={{ fontSize: 24 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edycja posta */}
      <Modal visible={!!editingPost} transparent animationType="fade" onRequestClose={() => setEditingPost(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'center', padding: 20 }}
          onPress={() => setEditingPost(null)}
        >
          <Pressable
            style={{
              backgroundColor: theme.surface, borderRadius: 18, padding: 16,
              borderWidth: 1, borderColor: theme.border2,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 12, marginBottom: 12 }}>EDYTUJ POST</Text>
            <TextInput
              style={{
                minHeight: 100, maxHeight: 180, textAlignVertical: 'top',
                backgroundColor: theme.surface2, borderRadius: 12, padding: 12,
                color: theme.text, borderWidth: 1, borderColor: theme.border,
              }}
              value={editPostText}
              onChangeText={setEditPostText}
              multiline
              placeholder="Treść posta..."
              placeholderTextColor={theme.textDim}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                onPress={() => setEditingPost(null)}
                disabled={savingEditPost}
              >
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12 }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: '#e33835', alignItems: 'center' }}
                onPress={() => { void handleSaveEditPost(); }}
                disabled={savingEditPost}
              >
                {savingEditPost
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 12, fontWeight: '700' }}>ZAPISZ</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edycja komentarza */}
      <Modal visible={!!editingComment} transparent animationType="fade" onRequestClose={() => setEditingComment(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'center', padding: 20 }}
          onPress={() => setEditingComment(null)}
        >
          <Pressable
            style={{
              backgroundColor: theme.surface, borderRadius: 18, padding: 16,
              borderWidth: 1, borderColor: theme.border2,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 12, marginBottom: 12 }}>EDYTUJ KOMENTARZ</Text>
            <TextInput
              style={{
                minHeight: 80, maxHeight: 160, textAlignVertical: 'top',
                backgroundColor: theme.surface2, borderRadius: 12, padding: 12,
                color: theme.text, borderWidth: 1, borderColor: theme.border,
              }}
              value={editCommentText}
              onChangeText={setEditCommentText}
              multiline
              placeholder="Treść komentarza..."
              placeholderTextColor={theme.textDim}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                onPress={() => setEditingComment(null)}
                disabled={savingEditComment}
              >
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12 }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: '#e33835', alignItems: 'center' }}
                onPress={() => { void handleSaveEditComment(); }}
                disabled={savingEditComment}
              >
                {savingEditComment
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 12, fontWeight: '700' }}>ZAPISZ</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* PhotoViewer z komentarzy renderowany jako overlay wewnątrz modala komentarzy */}
    </SafeAreaView>
  );
}
