import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  Image, ActivityIndicator, Keyboard, Modal, Pressable, StatusBar, ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect }        from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { useSettings }        from '../../../contexts/SettingsContext';
import { API_URL }            from '../../../constants/config';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { RouteMiniMap }          from '../../../components/profile/RouteMiniMap';
import { RouteLeaderboardModal } from '../../../components/modals/RouteLeaderboardModal';
import { useRouteLeaderboard }   from '../../../hooks/useRouteLeaderboard';
import {
  type Author, type Comment, type Post, type PublicRoute, type CommunityCar, type Tab,
  Avatar, PhotoViewer, LoadingView,
  renderDiscussionBody, searchMentionUsers, resolveMentionUserId,
} from './communityShared';
import { useKeyboardInset } from '../../../hooks/useKeyboardInset';
import { TabDyskusje } from './TabDyskusje';
import {
  reportContent, showBlockUserAlert, syncBlockedUserIdsFromServer,
} from '../../../lib/ugcActions';
import { TabTrasy }    from './TabTrasy';
import { TabAuta }     from './TabAuta';

const PAGE_SIZE = 20;
const getToken = () => AsyncStorage.getItem('token');

export default function CommunityScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { settings, updateSetting } = useSettings();
  const insets = useSafeAreaInsets();

  const [activeTab,    setActiveTab]    = useState<Tab>('dyskusje');
  const [myId,         setMyId]         = useState<number | null>(null);
  const [blockedIds,   setBlockedIds]   = useState<number[]>([]);
  const [search,       setSearch]       = useState('');
  const [searchActive, setSearchActive] = useState(false);

  // Posts
  const [posts,        setPosts]        = useState<Post[]>([]);
  const [loadingP,     setLoadingP]     = useState(true);
  const [refreshingP,  setRefreshingP]  = useState(false);
  const [postCursor,   setPostCursor]   = useState<number | null>(null);
  const [loadingMoreP, setLoadingMoreP] = useState(false);
  const [hasMoreP,     setHasMoreP]     = useState(true);

  // Routes
  const [routes,        setRoutes]        = useState<PublicRoute[]>([]);
  const [loadingR,      setLoadingR]      = useState(false);
  const [refreshingR,   setRefreshingR]   = useState(false);
  const [routeCursor,   setRouteCursor]   = useState<number | null>(null);
  const [loadingMoreR,  setLoadingMoreR]  = useState(false);
  const [hasMoreR,      setHasMoreR]      = useState(true);

  // Cars
  const [cars,        setCars]        = useState<CommunityCar[]>([]);
  const [loadingC,    setLoadingC]    = useState(false);
  const [refreshingC, setRefreshingC] = useState(false);
  const [carCursor,   setCarCursor]   = useState<number | null>(null);
  const [loadingMoreC,setLoadingMoreC]= useState(false);
  const [hasMoreC,    setHasMoreC]    = useState(true);

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
  const commentMentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentListRef = useRef<FlatList<Comment>>(null);
  const commentKeyboardInset = useKeyboardInset(!!commentPost);

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
    AsyncStorage.getItem('user').then(raw => {
      if (raw) { const u = JSON.parse(raw); setMyId(u.userId ?? u.id); }
    });
  }, []);

  // ── Fetch functions ──────────────────────────────────────
  const fetchPosts = useCallback(async (cursor?: number) => {
    try {
      const token = await getToken();
      const url   = cursor
        ? `${API_URL}/api/posts?cursor=${cursor}&limit=${PAGE_SIZE}`
        : `${API_URL}/api/posts?limit=${PAGE_SIZE}`;
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const newPosts = data.posts ?? [];
      if (cursor) setPosts(prev => [...prev, ...newPosts]);
      else        setPosts(newPosts);
      setPostCursor(data.nextCursor ?? null);
      setHasMoreP(!!data.nextCursor);
    } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania postów' }); }
    finally { setLoadingP(false); setRefreshingP(false); setLoadingMoreP(false); }
  }, []);

  const fetchRoutes = useCallback(async (cursor?: number) => {
    if (!cursor) setLoadingR(true);
    try {
      const token = await getToken();
      const url   = cursor
        ? `${API_URL}/api/routes/community?cursor=${cursor}&limit=${PAGE_SIZE}`
        : `${API_URL}/api/routes/community?limit=${PAGE_SIZE}`;
      const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json  = await res.json();
      const newRoutes  = Array.isArray(json) ? json : json.routes ?? [];
      const nextCursor = Array.isArray(json) ? null : (json.nextCursor ?? null);
      if (cursor) setRoutes(prev => [...prev, ...newRoutes]);
      else        setRoutes(newRoutes);
      setRouteCursor(nextCursor);
      setHasMoreR(!!nextCursor);
    } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania tras' }); }
    finally { setLoadingR(false); setRefreshingR(false); setLoadingMoreR(false); }
  }, []);

  const fetchCars = useCallback(async (cursor?: number) => {
    if (!cursor) setLoadingC(true);
    try {
      const token = await getToken();
      const url   = cursor
        ? `${API_URL}/api/cars/community?cursor=${cursor}&limit=${PAGE_SIZE}`
        : `${API_URL}/api/cars/community?limit=${PAGE_SIZE}`;
      const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json  = await res.json();
      const newCars    = Array.isArray(json) ? json : json.cars ?? [];
      const nextCursor = Array.isArray(json) ? null : (json.nextCursor ?? null);
      if (cursor) setCars(prev => [...prev, ...newCars]);
      else        setCars(newCars);
      setCarCursor(nextCursor);
      setHasMoreC(!!nextCursor);
    } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania aut' }); }
    finally { setLoadingC(false); setRefreshingC(false); setLoadingMoreC(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoadingP(true);
    setHasMoreP(true); setHasMoreR(true); setHasMoreC(true);
    fetchPosts(); fetchRoutes(); fetchCars();
    void syncBlockedUserIdsFromServer().then(setBlockedIds);
  }, []));

  const loadMorePosts  = useCallback(() => { if (!postCursor  || loadingMoreP || !hasMoreP) return; setLoadingMoreP(true);  fetchPosts(postCursor);   }, [postCursor,  loadingMoreP,  hasMoreP,  fetchPosts]);
  const loadMoreRoutes = useCallback(() => { if (!routeCursor || loadingMoreR || !hasMoreR) return; setLoadingMoreR(true); fetchRoutes(routeCursor); }, [routeCursor, loadingMoreR, hasMoreR, fetchRoutes]);
  const loadMoreCars   = useCallback(() => { if (!carCursor   || loadingMoreC || !hasMoreC) return; setLoadingMoreC(true);   fetchCars(carCursor);    }, [carCursor,   loadingMoreC,  hasMoreC,  fetchCars]);

  const openLeaderboard = useCallback(async (route: PublicRoute) => {
    setLbRoute(route);
    await Promise.all([fetchLeaderboard(route.id), fetchRuns(route.id)]);
  }, [fetchLeaderboard, fetchRuns]);

  // ── Actions ──────────────────────────────────────────────
  const handleLikePost = useCallback(async (id: number) => {
    setPosts(prev => prev.map(p => p.id !== id ? p : { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 }));
    const token = await getToken();
    await fetch(`${API_URL}/api/posts/${id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  }, []);

  const handleRepost = useCallback(async (id: number) => {
    setPosts(prev => prev.map(p => p.id !== id ? p : { ...p, isReposted: !p.isReposted, repostsCount: p.isReposted ? p.repostsCount - 1 : p.repostsCount + 1 }));
    const token = await getToken();
    await fetch(`${API_URL}/api/posts/${id}/repost`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  }, []);

  const handleDeletePost = useCallback(async (id: number) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    const token = await getToken();
    await fetch(`${API_URL}/api/posts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  }, []);

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
    const token = await getToken();
    await fetch(`${API_URL}/api/routes/${id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  }, []);

  const handleLikeCar = useCallback(async (id: number) => {
    setCars(prev => prev.map(c => c.id !== id ? c : { ...c, isLiked: !c.isLiked, likesCount: c.isLiked ? c.likesCount - 1 : c.likesCount + 1 }));
    const token = await getToken();
    await fetch(`${API_URL}/api/cars/${id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  }, []);

  const handleNavigateRoute = useCallback(async (route: PublicRoute) => {
    await AsyncStorage.setItem('nav_route', JSON.stringify({ routeId: route.id, routeName: route.name, points: route.points, distance: route.distance }));
    router.push('/(tabs)/map' as any);
  }, [router]);

  const handlePost = async (text: string, photos: string[], video: string | null, poll?: { question: string; options: string[] } | null) => {
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('content', text);
      if (poll) form.append('poll', JSON.stringify(poll));
      photos.forEach((uri, i) => { const ext = uri.split('.').pop() ?? 'jpg'; form.append('photos', { uri, name: `p${i}.${ext}`, type: `image/${ext}` } as any); });
      if (video) { const ext = video.split('.').pop() ?? 'mp4'; form.append('video', { uri: video, name: `video.${ext}`, type: `video/${ext}` } as any); }
      const res  = await fetch(`${API_URL}/api/posts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? 'Błąd');
      }
      const post = await res.json();
      setPosts(prev => [post, ...prev]);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e?.message ?? 'Błąd wysyłania' });
    }
  };

  const handlePollVote = useCallback(async (postId: number, optionIdx: number) => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/posts/${postId}/poll/vote`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ optionIdx }),
      });
      const data = await res.json();
      if (!res.ok) {
        Toast.show({ type: 'error', text1: data?.error ?? 'Nie udało się zagłosować' });
        return null;
      }
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
      return updated;
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      return null;
    }
  }, []);

  const openShareRoute = async (route: PublicRoute) => {
    setShareRoute(route); setShareSent([]); setShareLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/chat/conversations`, { headers: { Authorization: `Bearer ${token}` } });
      const json  = await res.json();
      setShareConvs(Array.isArray(json) ? json : json.conversations ?? []);
    } catch {} finally { setShareLoading(false); }
  };

  const handleSendRouteToChat = async (convId: number) => {
    if (!shareRoute) return;
    setShareSending(convId);
    try {
      const token   = await getToken();
      const content = JSON.stringify({ type: 'route', routeId: shareRoute.id, name: shareRoute.name, distance: shareRoute.distance, points: shareRoute.points.slice(0, 50), isPublic: shareRoute.isPublic });
      const form    = new FormData();
      form.append('content', content);
      await fetch(`${API_URL}/api/chat/conversations/${convId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      setShareSent(prev => [...prev, convId]);
    } catch {} finally { setShareSending(null); }
  };

  const openComments = useCallback(async (post: Post) => {
    setCommentPost(post); setComments([]); setLoadingComments(true);
    setCommentMentionUsers([]);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/posts/${post.id}/comments`, { headers: { Authorization: `Bearer ${token}` } });
      const data  = await res.json();
      setComments(Array.isArray(data) ? data : []);
    } catch {} finally { setLoadingComments(false); }
  }, []);

  const handleSendComment = async () => {
    if (!commentText.trim() && commentPhotos.length === 0) return;
    if (!commentPost) return;
    setPostingComment(true);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('content', commentText.trim());
      if (replyTo) form.append('replyToId', String(replyTo.id));
      commentPhotos.forEach((uri, i) => { const ext = uri.split('.').pop() ?? 'jpg'; form.append('photos', { uri, name: `cp${i}.${ext}`, type: `image/${ext}` } as any); });
      const res     = await fetch(`${API_URL}/api/posts/${commentPost.id}/comments`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const comment = await res.json();
      setComments(prev => [...prev, comment]);
      setCommentText(''); setCommentPhotos([]); setReplyTo(null);
      setPosts(prev => prev.map(p => p.id === commentPost.id ? { ...p, commentsCount: p.commentsCount + 1 } : p));
    } catch {} finally { setPostingComment(false); }
  };

  const pickCommentPhoto = async () => {
    if (commentPhotos.length >= 2) return;
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!r.canceled && r.assets[0]) setCommentPhotos(prev => [...prev, r.assets[0].uri]);
  };

  useFocusEffect(useCallback(() => {
    (async () => {
      const postId = await AsyncStorage.getItem('open_post_id');
      if (!postId) return;
      await AsyncStorage.removeItem('open_post_id');
      const existing = posts.find(p => p.id === Number(postId));
      setActiveTab('dyskusje');
      if (existing) { openComments(existing); return; }
      try {
        const token = await getToken();
        const res   = await fetch(`${API_URL}/api/posts/${postId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) openComments(await res.json());
      } catch {}
    })();
  }, [posts, openComments]));

  // ── Filtered lists ───────────────────────────────────────
  const visiblePosts = posts.filter((p) => !blockedIds.includes(p.author.id));
  const filteredPosts  = search.trim()
    ? visiblePosts.filter(p => p.content.toLowerCase().includes(search.toLowerCase()) || p.author.username.toLowerCase().includes(search.toLowerCase()))
    : visiblePosts;
  const filteredRoutes = search.trim() ? routes.filter(r => r.name.toLowerCase().includes(search.toLowerCase())     || r.author.username.toLowerCase().includes(search.toLowerCase())) : routes;
  const filteredCars   = search.trim() ? cars.filter(c   => c.brand.toLowerCase().includes(search.toLowerCase())    || c.owner.username.toLowerCase().includes(search.toLowerCase())) : cars;

  const modalBottomPadding = Math.max(insets.bottom, 12);

  // ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ── HEADER ─────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: theme.border,
        backgroundColor: theme.surface,
      }}>
        {searchActive ? (
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center',
            backgroundColor: theme.surface2, borderRadius: 14,
            paddingHorizontal: 12, paddingVertical: 10,
            gap: 8, borderWidth: 1, borderColor: '#e3383530',
          }}>
            <MaterialIcons name="search" size={16} color="#e33835" />
            <TextInput
              style={{ flex: 1, color: theme.text, fontSize: 14, fontFamily: 'Orbitron' }}
              value={search} onChangeText={setSearch}
              placeholder="Szukaj..." placeholderTextColor={theme.textDim}
              autoFocus
            />
            <TouchableOpacity onPress={() => { setSearch(''); setSearchActive(false); }}>
              <MaterialIcons name="close" size={16} color={theme.textDim} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
              <MaterialIcons name="arrow-back" size={22} color={theme.text} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#e33835' }} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14, letterSpacing: 3, fontWeight: '700' }}>
                SPOŁECZNOŚĆ
              </Text>
            </View>
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
                  color={settings.notifDiscussionPosts ? '#e33835' : theme.textDim}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSearchActive(true)} style={{ padding: 4 }}>
                <MaterialIcons name="search" size={22} color={theme.textDim} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* ── ZAKŁADKI ───────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', marginHorizontal: 12,
        marginTop: 10, marginBottom: 6,
        backgroundColor: theme.surface2, borderRadius: 16, padding: 4,
        borderWidth: 1, borderColor: theme.border,
      }}>
        {([
          { key: 'dyskusje', label: 'DYSKUSJE', icon: 'forum' },
          { key: 'trasy',    label: 'TRASY',    icon: 'map' },
          { key: 'auta',     label: 'AUTA',     icon: 'directions-car' },
        ] as { key: Tab; label: string; icon: string }[]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              justifyContent: 'center', gap: 5,
              paddingVertical: 10, borderRadius: 12,
            }, activeTab === tab.key && { backgroundColor: '#e33835' }]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.8}
          >
            <MaterialIcons name={tab.icon as any} size={14} color={activeTab === tab.key ? '#fff' : theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', color: activeTab === tab.key ? '#fff' : theme.textDim }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ══ DYSKUSJE ══════════════════════════════════════════ */}
      {activeTab === 'dyskusje' && (
        <View style={{ flex: 1 }}>
          {loadingP ? <LoadingView /> : (
            <TabDyskusje
              posts={filteredPosts} myId={myId} loadingMoreP={loadingMoreP}
              refreshingP={refreshingP} hasMoreP={hasMoreP}
              onLike={handleLikePost} onRepost={handleRepost} onComment={openComments}
              onDelete={handleDeletePost} onPost={handlePost} onPollVote={handlePollVote}
              onReport={handleReportPost}
              onBlock={handleBlockPostAuthor}
              onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
              onRefresh={() => { setRefreshingP(true); setHasMoreP(true); fetchPosts(); }}
              onLoadMore={loadMorePosts} bottomInset={insets.bottom}
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

      {/* ══ AUTA ══════════════════════════════════════════════ */}
      {activeTab === 'auta' && (
        <View style={{ flex: 1 }}>
        {loadingC ? <LoadingView /> :
        <TabAuta
          cars={filteredCars} myId={myId} loadingC={loadingC}
          loadingMoreC={loadingMoreC} refreshingC={refreshingC} hasMoreC={hasMoreC}
          onLike={handleLikeCar}
          onRefresh={() => { setRefreshingC(true); setHasMoreC(true); fetchCars(); }}
          onLoadMore={loadMoreCars} onShareCar={() => fetchCars()}
          bottomInset={insets.bottom} router={router}
        />
        }
        </View>
      )}

      {/* ══ MODAL KOMENTARZY ══════════════════════════════════ */}
      <Modal
        visible={!!commentPost}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setCommentPost(null)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000bb' }}>
          <Pressable style={{ flex: 1 }} onPress={() => { Keyboard.dismiss(); setCommentPost(null); }} />
          <View
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 28, borderTopRightRadius: 28,
              borderWidth: 1, borderColor: theme.border2,
              maxHeight: commentKeyboardInset > 0 ? '82%' : '88%',
              marginBottom: commentKeyboardInset,
            }}
          >
            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
              {/* Handle */}
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />

              {/* Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, letterSpacing: 2 }}>KOMENTARZE</Text>
                <TouchableOpacity
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}
                  onPress={() => setCommentPost(null)}
                >
                  <MaterialIcons name="close" size={16} color={theme.textDim} />
                </TouchableOpacity>
              </View>

              {/* Post preview */}
              {commentPost && (
                <View style={{
                  flexDirection: 'row', gap: 10, marginBottom: 12,
                  backgroundColor: theme.surface2, borderRadius: 14, padding: 10,
                  borderWidth: 1, borderColor: theme.border,
                }}>
                  <Avatar user={commentPost.author} size={30} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, marginBottom: 3 }}>{commentPost.author.username}</Text>
                    {commentPost.content.length > 0 && (
                      <Text style={{ fontSize: 13, lineHeight: 18 }} numberOfLines={4}>
                        {renderDiscussionBody(commentPost.content, theme, {
                          textColor: theme.textDim,
                          onMentionPress: async (username) => {
                            const uid = await resolveMentionUserId(username);
                            if (uid) router.push({ pathname: '/profile/[userId]', params: { userId: String(uid) } });
                          },
                        })}
                      </Text>
                    )}
                    {commentPost.photos?.length > 0 && (
                      <TouchableOpacity onPress={() => { setCommentPhotoUris(commentPost.photos); setCommentPhotoIdx(0); setCommentPhotoViewer(true); }}>
                        <Image source={{ uri: commentPost.photos[0] }} style={{ width: 60, height: 44, borderRadius: 8, marginTop: 6 }} resizeMode="cover" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 12 }} />

              {/* Lista komentarzy */}
              {loadingComments ? (
                <ActivityIndicator color="#e33835" style={{ margin: 30 }} />
              ) : (
                <FlatList
                  ref={commentListRef}
                  data={comments}
                  keyExtractor={c => String(c.id)}
                  style={{ maxHeight: commentKeyboardInset > 0 ? 180 : 300 }}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                      <Avatar user={item.author} size={32} />
                      <View style={{
                        flex: 1, backgroundColor: theme.surface2,
                        borderRadius: 14, padding: 10,
                        borderWidth: 1, borderColor: theme.border,
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 10, fontWeight: '700' }}>{item.author.username}</Text>
                          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: pl })}
                          </Text>
                          {item.author.id !== myId && (
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
                            <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 8 }}>↩ odpowiedz</Text>
                          </TouchableOpacity>
                        </View>
                        {item.replyTo && (
                          <Text style={{ fontFamily: 'Orbitron', color: '#e3383555', fontSize: 8, marginBottom: 4 }}>
                            ↩ @{item.replyTo.username}
                          </Text>
                        )}
                        <Text style={{ fontSize: 13, lineHeight: 19 }}>
                          {renderDiscussionBody(item.content, theme, {
                            onMentionPress: async (username) => {
                              const uid = await resolveMentionUserId(username);
                              if (uid) router.push({ pathname: '/profile/[userId]', params: { userId: String(uid) } });
                            },
                          })}
                        </Text>
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
                    <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, textAlign: 'center', marginTop: 24 }}>
                      BRAK KOMENTARZY · BĄDŹ PIERWSZY
                    </Text>
                  }
                  keyboardShouldPersistTaps="handled"
                />
              )}
            </View>

            {/* Input komentarza — sticky footer nad klawiaturą */}
            <View style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: commentKeyboardInset > 0
                ? commentKeyboardInset + 8
                : modalBottomPadding,
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
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>↩ @{replyTo.username}</Text>
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
                  onFocus={() => {
                    setTimeout(() => commentListRef.current?.scrollToEnd({ animated: true }), 120);
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
        </View>
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
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>WYŚLIJ TRASĘ</Text>
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
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{shareRoute.name}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginTop: 3 }}>{shareRoute.distance.toFixed(1)} km · {shareRoute.points.length} pkt</Text>
                </View>
              </View>
            )}
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2, marginBottom: 10 }}>WYBIERZ ROZMOWĘ</Text>
            {shareLoading ? (
              <ActivityIndicator color="#e33835" style={{ marginVertical: 30 }} />
            ) : (
              <FlatList
                data={shareConvs} keyExtractor={c => String(c.id)}
                style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={<Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, textAlign: 'center', marginTop: 30 }}>Brak rozmów</Text>}
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
                            <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>{name.slice(0, 2).toUpperCase()}</Text>
                          </View>
                      }
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '600' }} numberOfLines={1}>{name}</Text>
                        {conv.isGroup && <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>{conv.participants?.length} uczestników</Text>}
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
                            ? <><MaterialIcons name="check" size={13} color="#4de926" /><Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#4de926', fontWeight: '700' }}>WYSŁANO</Text></>
                            : <><MaterialIcons name="send" size={13} color="#fff" /><Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>WYŚLIJ</Text></>
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

      {/* ══ PHOTO VIEWER (globalny) ════════════════════════════ */}
      <PhotoViewer
        photos={commentPhotoUris}
        initialIndex={commentPhotoIdx}
        visible={commentPhotoViewer}
        onClose={() => setCommentPhotoViewer(false)}
      />
    </SafeAreaView>
  );
}