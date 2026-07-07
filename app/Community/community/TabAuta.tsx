import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, FlatList, RefreshControl,
  Pressable, ActivityIndicator, Dimensions, ScrollView,
  Alert, StyleSheet,
} from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../contexts/ThemeContext';
import { type VroomkiPost, Avatar, ListFooter } from './communityShared';
import { ShareVroomkiModal } from '../../../components/modals/ShareVroomkiModal';
import { VroomkiOverlays } from '../../../components/vroomki/VroomkiOverlays';
import { VroomkiSoundChip } from '../../../components/vroomki/VroomkiSoundPicker';
import { VroomkiCommentsModal } from '../../../components/vroomki/VroomkiCommentsModal';
import { VroomkiPrefetch } from '../../../components/vroomki/VroomkiPrefetch';
import { useVroomkiSoundPlayback } from '../../../hooks/useVroomkiSoundPlayback';
import { pickVroomkiMediaFromGallery } from '../../../lib/pickVroomkiMedia';
import { setVroomkiDraft } from '../../../lib/vroomkiTypes';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const FALLBACK_REEL_H = Math.max(560, SCREEN_H - 190);
const VIEW_THRESHOLD_MS = 1600;
const DOUBLE_TAP_MS = 280;

async function openVroomkiCreateFlow(router: ReturnType<typeof useRouter>) {
  const picked = await pickVroomkiMediaFromGallery();
  if (!picked) return;
  setVroomkiDraft({
    photos: picked.kind === 'photos' ? picked.photos : [],
    video: picked.kind === 'video' ? picked.video : null,
    overlays: [],
    sound: null,
    useOriginalAudio: picked.kind === 'video',
    soundStartMs: 0,
    photoDurationMs: 3000,
    clipStartMs: 0,
    clipDurationMs: null,
  });
  router.push('/Community/vroomki/create');
}

function ReelVideo({
  uri,
  active,
  muted = false,
  clipStartMs = 0,
  clipDurationMs = null,
  onCompleted,
  onDoubleTap,
  onMediaReadyChange,
}: {
  uri: string;
  active: boolean;
  muted?: boolean;
  clipStartMs?: number;
  clipDurationMs?: number | null;
  onCompleted: (watchMs: number) => void;
  onDoubleTap: () => void;
  onMediaReadyChange?: (ready: boolean) => void;
}) {
  const videoRef = useRef<Video>(null);
  const completedRef = useRef(false);
  const readyRef = useRef(false);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const clipEndMs = clipDurationMs ? clipStartMs + clipDurationMs : null;

  const reportReady = (ready: boolean) => {
    if (readyRef.current === ready) return;
    readyRef.current = ready;
    onMediaReadyChange?.(ready);
  };

  useEffect(() => {
    if (!active) {
      setPausedByUser(false);
      reportReady(false);
      videoRef.current?.pauseAsync().catch(() => {});
      return;
    }
    if (pausedByUser) {
      reportReady(false);
      videoRef.current?.pauseAsync().catch(() => {});
      return;
    }
    videoRef.current?.playAsync().catch(() => {});
  }, [active, pausedByUser]);

  useEffect(() => {
    if (!active) return;
    completedRef.current = false;
    reportReady(false);
    videoRef.current?.setPositionAsync(clipStartMs).catch(() => {});
  }, [active, uri, clipStartMs]);

  const onStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      reportReady(false);
      return;
    }
    setPlaying(!!status.isPlaying);
    if (status.isPlaying || (status.positionMillis ?? 0) > 0) setHasLoadedOnce(true);
    setBuffering(!!status.isBuffering && !status.isPlaying);

    const position = status.positionMillis ?? 0;
    const isReady = active && !pausedByUser && !status.isBuffering && (status.isPlaying || position >= 60);
    reportReady(isReady);

    const duration = status.durationMillis ?? 0;

    if (clipEndMs && position >= clipEndMs - 80) {
      videoRef.current?.setPositionAsync(clipStartMs).catch(() => {});
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleted(clipDurationMs ?? position);
      }
      return;
    }

    if (!completedRef.current && duration > 0 && position / duration >= 0.85) {
      completedRef.current = true;
      onCompleted(position);
    }
  };

  const toggle = async () => {
    const nextPaused = !pausedByUser;
    setPausedByUser(nextPaused);
    try {
      if (nextPaused) await videoRef.current?.pauseAsync();
      else await videoRef.current?.playAsync();
    } catch {}
  };

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      lastTapRef.current = 0;
      onDoubleTap();
      return;
    }
    lastTapRef.current = now;
    singleTapTimerRef.current = setTimeout(() => {
      void toggle();
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => () => {
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
  }, []);

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={handlePress}>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay={active && !pausedByUser}
        isLooping={!clipEndMs}
        isMuted={muted}
        useNativeControls={false}
        progressUpdateIntervalMillis={250}
        onPlaybackStatusUpdate={onStatus}
      />
      {(pausedByUser || (!hasLoadedOnce && active) || (buffering && !playing)) && (
        <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: '#0000008c', justifyContent: 'center', alignItems: 'center' }}>
            {(!hasLoadedOnce && active) || (buffering && !playing)
              ? <ActivityIndicator color="#fff" />
              : <MaterialIcons name="play-arrow" size={42} color="#fff" style={{ marginLeft: 3 }} />}
          </View>
        </View>
      )}
    </Pressable>
  );
}

function ReelCard({
  post,
  active,
  height,
  myId,
  onLike,
  onOpenComments,
  onShare,
  onFollowAuthor,
  onProfile,
  onCar,
  onMore,
  onCompletedView,
  onOpenSound,
}: {
  post: VroomkiPost;
  active: boolean;
  height: number;
  myId: number | null;
  onLike: (id: number) => void;
  onOpenComments: (post: VroomkiPost) => void;
  onShare: (post: VroomkiPost) => void;
  onFollowAuthor: (authorId: number) => void;
  onProfile: (id: number) => void;
  onCar: (id: number) => void;
  onMore: (post: VroomkiPost) => void;
  onCompletedView: (post: VroomkiPost, watchMs: number) => void;
  onOpenSound?: (soundId: number) => void;
}) {
  const time = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: pl });
  const hasVideo = post.videos.length > 0;
  const photos = post.photos.length > 0 ? post.photos : (post.car?.photos ?? []);
  const coverPhoto = photos[0] ?? null;
  const own = myId === post.author.id;
  const [photoIndex, setPhotoIndex] = useState(0);
  const [heartVisible, setHeartVisible] = useState(false);
  const lastTapRef = useRef(0);
  const likedByDoubleTapRef = useRef(false);
  const photoDurationMs = post.photoDurationMs ?? 3000;
  const clipStartMs = post.clipStartMs ?? 0;
  const clipDurationMs = post.clipDurationMs ?? null;
  const overlays = post.overlays ?? [];
  const externalSound = post.sound?.audioUrl ? post.sound : null;
  const [videoMediaReady, setVideoMediaReady] = useState(false);

  useVroomkiSoundPlayback({
    active,
    sound: externalSound,
    soundStartMs: post.soundStartMs ?? 0,
    restartKey: post.id,
    waitForMedia: hasVideo,
    mediaReady: hasVideo ? videoMediaReady : true,
  });

  useEffect(() => {
    if (!hasVideo) setVideoMediaReady(false);
  }, [post.id, hasVideo]);

  useEffect(() => {
    if (hasVideo || photos.length <= 1 || !active) return undefined;
    const timer = setInterval(() => {
      setPhotoIndex((prev) => (prev + 1) % photos.length);
    }, photoDurationMs);
    return () => clearInterval(timer);
  }, [hasVideo, photos.length, photoDurationMs, active, post.id]);

  const likeFromDoubleTap = useCallback(() => {
    setHeartVisible(true);
    setTimeout(() => setHeartVisible(false), 650);
    if (!likedByDoubleTapRef.current && !post.isLiked) {
      likedByDoubleTapRef.current = true;
      onLike(post.id);
    }
  }, [onLike, post.id, post.isLiked]);

  useEffect(() => {
    if (!post.isLiked) likedByDoubleTapRef.current = false;
  }, [post.isLiked]);

  const handlePhotoPress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      likeFromDoubleTap();
      return;
    }
    lastTapRef.current = now;
  };

  return (
    <View style={{ height, backgroundColor: '#050505', overflow: 'hidden' }}>
      {hasVideo ? (
        <ReelVideo
          uri={post.videos[0]}
          active={active}
          muted={!!externalSound}
          clipStartMs={clipStartMs}
          clipDurationMs={clipDurationMs}
          onMediaReadyChange={setVideoMediaReady}
          onCompleted={(ms) => onCompletedView(post, ms)}
          onDoubleTap={likeFromDoubleTap}
        />
      ) : coverPhoto ? (
        <Pressable onPress={handlePhotoPress} style={{ width: SCREEN_W, height }}>
          <Image source={{ uri: photos[photoIndex] ?? coverPhoto }} style={{ width: SCREEN_W, height }} resizeMode="cover" />
        </Pressable>
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#170909' }]}>
          <MaterialIcons name="directions-car" size={86} color="#e3383555" />
        </View>
      )}

      <VroomkiOverlays overlays={overlays} width={SCREEN_W} height={height} />

      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.18)' }]} pointerEvents="none" />
      {heartVisible && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
          <MaterialCommunityIcons name="heart" size={104} color="#ffffffde" />
        </View>
      )}
      <View style={{ position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#00000078', borderRadius: 999, padding: 6, paddingRight: 12 }}>
          <MaterialIcons name="local-fire-department" size={16} color="#e33835" />
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10, letterSpacing: 1 }}>VROOMKI</Text>
        </View>
        {photos.length > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#00000078', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }}>
            <MaterialIcons name="photo-library" size={14} color="#fff" />
            <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10 }}>{photoIndex + 1}/{photos.length}</Text>
          </View>
        )}
      </View>

      <View style={{ position: 'absolute', right: 12, bottom: 88, alignItems: 'center', gap: 18 }}>
        <View style={{ alignItems: 'center' }}>
          <TouchableOpacity onPress={() => onProfile(post.author.id)} activeOpacity={0.86}>
            <Avatar user={post.author} size={44} />
          </TouchableOpacity>
          {!own && (
            <TouchableOpacity
              onPress={() => onFollowAuthor(post.author.id)}
              activeOpacity={0.82}
              style={{
                marginTop: -10,
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: post.isFollowingAuthor ? '#111' : '#e33835',
                borderWidth: 2,
                borderColor: '#fff',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <MaterialIcons name={post.isFollowingAuthor ? 'check' : 'add'} size={15} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={() => onLike(post.id)} style={{ alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#00000078', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialCommunityIcons name={post.isLiked ? 'heart' : 'heart-outline'} size={28} color={post.isLiked ? '#e33835' : '#fff'} />
          </View>
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10, marginTop: 4 }}>{post.likesCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onOpenComments(post)} style={{ alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#00000078', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialCommunityIcons name="comment-outline" size={27} color="#fff" />
          </View>
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10, marginTop: 4 }}>{post.commentsCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onShare(post)} style={{ alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#00000078', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name="share" size={24} color="#fff" />
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onMore(post)}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#00000078', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name={own ? 'more-vert' : 'flag'} size={24} color="#fff" />
          </View>
        </TouchableOpacity>
      </View>

      <View style={{ position: 'absolute', left: 14, right: 78, bottom: 24 }}>
        <TouchableOpacity onPress={() => onProfile(post.author.id)} activeOpacity={0.8}>
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, fontWeight: '800' }}>@{post.author.username}</Text>
        </TouchableOpacity>
        {post.car && (
          <TouchableOpacity onPress={() => onCar(post.car!.id)} activeOpacity={0.82} style={{ alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#e33835d8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10 }} numberOfLines={1}>
              {post.car.brand} · {post.car.specs}
            </Text>
          </TouchableOpacity>
        )}
        {post.sound && (
          <VroomkiSoundChip
            sound={{
              id: post.sound.id,
              title: post.sound.title,
              artist: post.sound.artist,
              coverUrl: post.sound.coverUrl,
              audioUrl: post.sound.audioUrl,
              sourceType: post.sound.sourceType,
              sourceId: post.sound.sourceId ?? String(post.sound.id),
            }}
            onPress={post.sound.id && onOpenSound ? () => onOpenSound(post.sound!.id) : undefined}
          />
        )}
        {!!post.caption && (
          <Text style={{ color: '#fff', fontSize: 13, lineHeight: 18, marginTop: 9 }} numberOfLines={3}>{post.caption}</Text>
        )}
        <Text style={{ fontFamily: 'Orbitron', color: '#ffffffa8', fontSize: 9, marginTop: 8 }}>{time} · {post.viewsCount} wyświetleń</Text>
      </View>
    </View>
  );
}

export function TabAuta({
  posts, myId, focusPostId, loadingC, refreshingC, loadingMoreC, hasMoreC,
  onLike, onCreate, onDelete, onReport, onBlock, onView, onCommentAdded,
  onFollowAuthor, onRefresh, onLoadMore, bottomInset, router, hideFab = false,
}: {
  posts: VroomkiPost[];
  focusPostId?: number | null;
  myId: number | null;
  loadingC: boolean;
  refreshingC: boolean;
  loadingMoreC: boolean;
  hasMoreC: boolean;
  onLike: (id: number) => void;
  onCreate: (...args: any[]) => Promise<void>;
  onDelete: (id: number) => void;
  onReport: (post: VroomkiPost, reason: string) => void;
  onBlock: (post: VroomkiPost) => void;
  onView: (id: number, watchMs: number, completed: boolean) => void;
  onCommentAdded: (id: number) => void;
  onFollowAuthor: (authorId: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  bottomInset: number;
  router: ReturnType<typeof useRouter>;
  hideFab?: boolean;
}) {
  const { theme } = useTheme();
  const [commentsPost, setCommentsPost] = useState<VroomkiPost | null>(null);
  const [sharePost, setSharePost] = useState<VroomkiPost | null>(null);
  const [activeId, setActiveId] = useState<number | null>(posts[0]?.id ?? null);
  const [reelHeight, setReelHeight] = useState(FALLBACK_REEL_H);
  const listRef = useRef<FlatList<VroomkiPost> | null>(null);
  const dragStartIndexRef = useRef(0);
  const viewedRef = useRef<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusIdRef = useRef<number | null>(null);
  const initialActiveSetRef = useRef(false);

  useEffect(() => {
    if (initialActiveSetRef.current) return;
    if (!posts[0]) return;
    initialActiveSetRef.current = true;
    setActiveId(posts[0].id);
  }, [posts]);

  useEffect(() => {
    if (focusPostId != null && posts.length > 0 && reelHeight > 0) {
      const idx = posts.findIndex((p) => p.id === focusPostId);
      if (idx >= 0 && lastFocusIdRef.current !== focusPostId) {
        lastFocusIdRef.current = focusPostId;
        dragStartIndexRef.current = idx;
        setActiveId(posts[idx].id);
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: idx, animated: false });
        });
        return;
      }
    }
  }, [focusPostId, posts, reelHeight]);

  const reportSoftView = useCallback((post: VroomkiPost) => {
    if (viewedRef.current.has(post.id)) return;
    viewedRef.current.add(post.id);
    if (post.id < 0) return;
    onView(post.id, VIEW_THRESHOLD_MS, false);
  }, [onView]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const next = viewableItems?.[0]?.item as VroomkiPost | undefined;
    if (!next) return;
    setActiveId(next.id);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => reportSoftView(next), VIEW_THRESHOLD_MS);
  }).current;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const openMore = (post: VroomkiPost) => {
    const isOwn = myId === post.author.id;
    if (isOwn && post.legacyCarId) {
      Alert.alert('AUTO Z GARAŻU', 'To jest auto przeniesione ze starej zakładki. Zarządzasz nim w garażu.', [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Otwórz auto', onPress: () => router.push({ pathname: '/profile/car-detail', params: { id: String(post.legacyCarId) } }) },
      ]);
      return;
    }
    if (isOwn) {
      Alert.alert('VROOMKA', 'Co chcesz zrobić?', [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń', style: 'destructive', onPress: () => onDelete(post.id) },
      ]);
      return;
    }
    Alert.alert(`@${post.author.username}`, 'Zgłoszenie trafi do zespołu VROOM. Możesz też ukryć treści tego użytkownika.', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Zgłoś', onPress: () => onReport(post, 'other') },
      { text: 'Zablokuj użytkownika', style: 'destructive', onPress: () => onBlock(post) },
    ]);
  };

  const Empty = () => (
    <View style={{ minHeight: reelHeight, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, backgroundColor: theme.bg }}>
      <MaterialIcons name="smart-display" size={64} color="#e338354d" />
      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 16, letterSpacing: 2, marginTop: 18 }}>PIERWSZA VROOMKA?</Text>
      <Text style={{ color: theme.textDim, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>
        Wrzuć auto z garażu, zdjęcia albo film. Feed będzie uczył się po lajkach, komentarzach i oglądaniu.
      </Text>
      <TouchableOpacity onPress={() => void openVroomkiCreateFlow(router)} style={{ marginTop: 20, backgroundColor: '#e33835', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 13 }}>
        <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11 }}>DODAJ VROOMKĘ</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <VroomkiPrefetch posts={posts} activeId={activeId} />
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        removeClippedSubviews={false}
        maxToRenderPerBatch={3}
        windowSize={5}
        initialNumToRender={2}
        updateCellsBatchingPeriod={50}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height);
          if (next > 0 && Math.abs(next - reelHeight) > 2) setReelHeight(next);
        }}
        data={posts}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => (
          <ReelCard
            post={item}
            active={activeId === item.id}
            height={reelHeight}
            myId={myId}
            onLike={onLike}
            onFollowAuthor={onFollowAuthor}
            onOpenComments={setCommentsPost}
            onShare={setSharePost}
            onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
            onCar={id => router.push({ pathname: '/profile/car-detail', params: { id: String(id) } })}
            onMore={openMore}
            onOpenSound={(soundId) => router.push(`/Community/vroomki/sound/${soundId}`)}
            onCompletedView={(post, watchMs) => {
              viewedRef.current.add(post.id);
              if (post.id < 0) return;
              onView(post.id, watchMs, true);
            }}
          />
        )}
        pagingEnabled
        disableIntervalMomentum
        snapToInterval={reelHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        onScrollBeginDrag={(event) => {
          dragStartIndexRef.current = Math.round(event.nativeEvent.contentOffset.y / reelHeight);
        }}
        onMomentumScrollEnd={(event) => {
          const rawIndex = Math.round(event.nativeEvent.contentOffset.y / reelHeight);
          const startIndex = dragStartIndexRef.current;
          const targetIndex = Math.max(0, Math.min(posts.length - 1, Math.max(startIndex - 1, Math.min(startIndex + 1, rawIndex))));
          if (targetIndex !== rawIndex) {
            listRef.current?.scrollToIndex({ index: targetIndex, animated: true });
          }
          const nextPost = posts[targetIndex];
          if (nextPost) setActiveId(nextPost.id);
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshingC} onRefresh={onRefresh} tintColor="#e33835" />}
        onEndReached={hasMoreC ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        viewabilityConfig={{ itemVisiblePercentThreshold: 72, minimumViewTime: 280 }}
        onViewableItemsChanged={onViewableItemsChanged}
        getItemLayout={(_, index) => ({ length: reelHeight, offset: reelHeight * index, index })}
        ListEmptyComponent={!loadingC ? <Empty /> : null}
        ListFooterComponent={<ListFooter loading={loadingMoreC} />}
        contentContainerStyle={{ paddingBottom: 0 }}
      />

      {!hideFab && (
        <TouchableOpacity
          onPress={() => void openVroomkiCreateFlow(router)}
          activeOpacity={0.86}
          style={{
            position: 'absolute',
            right: 18,
            bottom: Math.max(bottomInset + 18, 32),
            width: 58,
            height: 58,
            borderRadius: 29,
            backgroundColor: '#e33835',
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#e33835',
            shadowOpacity: 0.35,
            shadowRadius: 14,
            elevation: 8,
          }}
        >
          <MaterialIcons name="add" size={30} color="#fff" />
        </TouchableOpacity>
      )}

      <VroomkiCommentsModal
        post={commentsPost}
        myId={myId}
        onClose={() => setCommentsPost(null)}
        onCommentAdded={onCommentAdded}
      />
      <ShareVroomkiModal
        visible={!!sharePost}
        post={sharePost}
        myId={myId}
        onClose={() => setSharePost(null)}
      />
    </>
  );
}
