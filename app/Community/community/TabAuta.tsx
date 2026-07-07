import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl,
  Dimensions, Alert, StyleSheet,
} from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';
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
import { VroomkiPhotoCarousel } from '../../../components/vroomki/VroomkiPhotoCarousel';
import { ReelVideo, isReelPostWarmed } from '../../../components/vroomki/ReelVideo';
import { VroomkiReelWarmup } from '../../../components/vroomki/VroomkiReelWarmup';
import { useVroomkiSoundPlayback } from '../../../hooks/useVroomkiSoundPlayback';
import { pickVroomkiMediaFromGallery } from '../../../lib/pickVroomkiMedia';
import { setVroomkiDraft } from '../../../lib/vroomkiTypes';
import { priorityPrefetchVroomkiVideo, warmFeedVideos } from '../../../lib/vroomkiVideoCache';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const FALLBACK_REEL_H = Math.max(560, SCREEN_H - 190);
const VIEW_THRESHOLD_MS = 1600;

const ReelCard = React.memo(function ReelCard({
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
  const likedByDoubleTapRef = useRef(false);
  const photoDurationMs = post.photoDurationMs ?? 3000;
  const clipStartMs = post.clipStartMs ?? 0;
  const clipDurationMs = post.clipDurationMs ?? null;
  const overlays = post.overlays ?? [];
  const externalSound = post.sound ?? null;
  const mediaReadyLatchRef = useRef(isReelPostWarmed(post.id));
  const [videoMediaReady, setVideoMediaReady] = useState(mediaReadyLatchRef.current);
  const [mediaLoopTick, setMediaLoopTick] = useState(0);

  const handleMediaReady = useCallback((ready: boolean) => {
    if (ready) mediaReadyLatchRef.current = true;
    setVideoMediaReady(mediaReadyLatchRef.current);
  }, []);

  useVroomkiSoundPlayback({
    active,
    sound: externalSound,
    soundStartMs: post.soundStartMs ?? 0,
    restartKey: post.id,
    mediaLoopTick,
    waitForMedia: hasVideo && !mediaReadyLatchRef.current,
    mediaReady: hasVideo ? videoMediaReady : true,
  });

  useEffect(() => {
    mediaReadyLatchRef.current = isReelPostWarmed(post.id);
    setVideoMediaReady(mediaReadyLatchRef.current);
    setMediaLoopTick(0);
  }, [post.id]);

  useEffect(() => {
    setPhotoIndex(0);
  }, [post.id]);

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

  return (
    <View style={{ height, backgroundColor: '#050505', overflow: 'hidden' }}>
      {hasVideo ? (
        <ReelVideo
          postId={post.id}
          uri={post.videos[0]}
          active={active}
          muted={!!externalSound}
          clipStartMs={clipStartMs}
          clipDurationMs={clipDurationMs}
          onMediaReadyChange={handleMediaReady}
          onClipLoop={() => setMediaLoopTick((t) => t + 1)}
          onCompleted={(ms) => onCompletedView(post, ms)}
          onDoubleTap={likeFromDoubleTap}
        />
      ) : coverPhoto ? (
        <VroomkiPhotoCarousel
          photos={photos}
          width={SCREEN_W}
          height={height}
          active={active}
          photoDurationMs={photoDurationMs}
          restartKey={post.id}
          onDoubleTap={likeFromDoubleTap}
          onIndexChange={setPhotoIndex}
        />
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
});

export function TabAuta({
  posts, myId, focusPostId, loadingC, refreshingC, loadingMoreC, hasMoreC,
  onLike, onCreate, onDelete, onReport, onBlock, onView, onCommentAdded,
  onFollowAuthor, onRefresh, onLoadMore, bottomInset, router, hideFab = false,
  feedActive = true,
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
  feedActive?: boolean;
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
  const [playbackSuspended, setPlaybackSuspended] = useState(false);
  const reelsPlaybackActive = feedActive && !playbackSuspended;

  const warmupUri = useMemo(() => {
    if (!activeId) return null;
    const idx = posts.findIndex((p) => p.id === activeId);
    if (idx < 0) return null;
    for (let i = idx + 1; i <= idx + 2; i += 1) {
      if (posts[i]?.videos[0]) return posts[i].videos[0];
    }
    return null;
  }, [posts, activeId]);

  useEffect(() => {
    if (feedActive) setPlaybackSuspended(false);
  }, [feedActive]);

  const suspendPlayback = useCallback(() => {
    setPlaybackSuspended(true);
  }, []);

  const startCreateFlow = useCallback(async () => {
    suspendPlayback();
    const picked = await pickVroomkiMediaFromGallery();
    if (!picked) {
      if (feedActive) setPlaybackSuspended(false);
      return;
    }
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
  }, [feedActive, router, suspendPlayback]);

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

  useEffect(() => {
    if (!activeId) return;
    const idx = posts.findIndex((p) => p.id === activeId);
    if (idx < 0) return;
    const urls = [
      posts[idx]?.videos[0],
      posts[idx - 1]?.videos[0],
      posts[idx + 1]?.videos[0],
      posts[idx + 2]?.videos[0],
    ];
    warmFeedVideos(urls);
  }, [activeId, posts]);

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
      <TouchableOpacity onPress={() => void startCreateFlow()} style={{ marginTop: 20, backgroundColor: '#e33835', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 13 }}>
        <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11 }}>DODAJ VROOMKĘ</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <VroomkiPrefetch posts={posts} activeId={activeId} />
      <VroomkiReelWarmup uri={warmupUri} />
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        removeClippedSubviews={false}
        maxToRenderPerBatch={5}
        windowSize={9}
        initialNumToRender={3}
        updateCellsBatchingPeriod={40}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height);
          if (next > 0 && Math.abs(next - reelHeight) > 2) setReelHeight(next);
        }}
        data={posts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <ReelCard
            post={item}
            active={reelsPlaybackActive && activeId === item.id}
            height={reelHeight}
            myId={myId}
            onLike={onLike}
            onFollowAuthor={onFollowAuthor}
            onOpenComments={setCommentsPost}
            onShare={setSharePost}
            onProfile={(id) => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
            onCar={(id) => router.push({ pathname: '/profile/car-detail', params: { id: String(id) } })}
            onMore={openMore}
            onOpenSound={(soundId) => {
              suspendPlayback();
              router.push(`/Community/vroomki/sound/${soundId}`);
            }}
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
          const idx = Math.round(event.nativeEvent.contentOffset.y / reelHeight);
          dragStartIndexRef.current = idx;
          const next = posts[idx + 1]?.videos[0];
          const prev = posts[idx - 1]?.videos[0];
          if (next) priorityPrefetchVroomkiVideo(next);
          if (prev) priorityPrefetchVroomkiVideo(prev);
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
          onPress={() => void startCreateFlow()}
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
