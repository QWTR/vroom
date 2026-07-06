import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Linking, TouchableOpacity, TextInput,
  Image, ActivityIndicator, Modal, ScrollView, Dimensions,
  Platform, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import { Video, ResizeMode, type AVPlaybackStatus, type AVPlaybackStatusSuccess }  from 'expo-av';
import Toast                  from 'react-native-toast-message';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets }  from 'react-native-safe-area-context';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';
import { filterProvinceSuggestions, getProvinceByMention } from '../../../constants/provinces';
import { useKeyboardInset }   from '../../../hooks/useKeyboardInset';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────
export interface DiscussionReaction { emoji: string; count: number; myReaction: boolean; }
export const DISCUSSION_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
export type DiscussionCategoryId =
  | 'ogolne'
  | 'porady_mechaniczne'
  | 'elektryka_diagnostyka'
  | 'modyfikacje_tuning'
  | 'pielegnacja_detailing'
  | 'trasy_wyjazdy'
  | 'pomoc_apka'
  | 'off_topic';
export const DISCUSSION_CATEGORIES: { id: DiscussionCategoryId; label: string; icon: string }[] = [
  { id: 'ogolne', label: 'Ogolne', icon: 'forum' },
  { id: 'porady_mechaniczne', label: 'Porady mechaniczne', icon: 'build' },
  { id: 'elektryka_diagnostyka', label: 'Elektryka i diagnostyka', icon: 'electrical-services' },
  { id: 'modyfikacje_tuning', label: 'Modyfikacje i tuning', icon: 'bolt' },
  { id: 'pielegnacja_detailing', label: 'Pielegnacja i detailing', icon: 'auto-fix-high' },
  { id: 'trasy_wyjazdy', label: 'Trasy i wyjazdy', icon: 'route' },
  { id: 'pomoc_apka', label: 'Pomoc / apka', icon: 'help-outline' },
  { id: 'off_topic', label: 'Off-topic', icon: 'chat-bubble-outline' },
];
export const DISCUSSION_ALL_CATEGORIES = 'all';
export type DiscussionCategoryFilter = DiscussionCategoryId | typeof DISCUSSION_ALL_CATEGORIES;

export function getDiscussionCategoryMeta(category?: string | null) {
  return DISCUSSION_CATEGORIES.find((c) => c.id === category) ?? DISCUSSION_CATEGORIES[0];
}

export interface Author       { id: number; username: string; avatarUrl: string | null; points: number; isPremium?: boolean; isAdmin?: boolean; nickColor?: string | null; }
export interface Comment      {
  id: number; content: string; photos: string[]; createdAt: string; author: Author;
  replyTo?: { id: number; username: string } | null;
  likesCount?: number; isLiked?: boolean;
  reactions?: DiscussionReaction[];
}
export interface PostPollData {
  id: number; question: string; options: string[];
  voteCounts: number[]; totalVotes: number; myVote: number | null;
}
export interface PostPollInput { question: string; options: string[]; }
export interface Post         {
  id: number; content: string; category: DiscussionCategoryId; photos: string[]; videos: string[]; createdAt: string; author: Author;
  likesCount: number; commentsCount: number; repostsCount: number; isLiked: boolean; isReposted: boolean;
  reactions?: DiscussionReaction[];
  poll?: PostPollData | null;
}
export interface PublicRoute  { id: number; name: string; description: string | null; distance: number; isPublic: boolean; createdAt: string; author: { id: number; username: string; avatarUrl: string | null }; points?: { latitude: number; longitude: number; order: number }[]; likesCount: number; isLiked: boolean; _count?: { likes: number }; runsCount?: number; }
export interface CommunityCar { id: number; brand: string; specs: string; isMain: boolean; photos: string[]; createdAt: string; sharedToCommunity: boolean; owner: { id: number; username: string; avatarUrl: string | null }; likesCount: number; commentsCount: number; isLiked: boolean; }
export type Tab = 'dyskusje' | 'trasy' | 'auta';

// ─── Utils ────────────────────────────────────────────────
export function extractUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

export function renderTextWithLinks(content: string, baseStyle: object, linkColor = '#4a9eff') {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlRegex);
  return parts.map((part, index) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <Text
          key={index}
          style={[baseStyle, { color: linkColor, textDecorationLine: 'underline' }]}
          onPress={() => Linking.openURL(part)}
          suppressHighlighting={false}
        >
          {part}
        </Text>
      );
    }
    return <Text key={index} style={baseStyle}>{part}</Text>;
  });
}

/** Hashtag: # + litery/cyfry/_ (w tym polskie znaki) */
const HASHTAG_BODY_RE = /^#[a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+$/;
const DISCUSSION_TOKEN_SPLIT_RE = /(@[a-zA-Z0-9_.-]+|#[a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)/g;

export function normalizeHashtag(raw: string): string {
  const tag = raw.replace(/^#+/, '').trim();
  return tag ? `#${tag.toLowerCase()}` : '';
}

/** Filtr listy dyskusji: #tag dopasowuje token hashtagu w treści posta */
export function postMatchesDiscussionSearch(content: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (q.startsWith('#') && q.length > 1) {
    const tag = q.slice(1).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`#${tag}(?![a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ])`, 'i').test(content);
  }
  return content.toLowerCase().includes(q.toLowerCase());
}

/** Tekst dyskusji / komentarzy: @wzmianki, #hashtagi + linki */
export function renderDiscussionBody(
  content: string,
  theme: { textMuted: string },
  opts?: {
    textColor?: string;
    mentionColor?: string;
    provinceMentionColor?: string;
    hashtagColor?: string;
    linkColor?: string;
    onMentionPress?: (username: string) => void;
    onHashtagPress?: (hashtag: string) => void;
  },
) {
  const baseStyle = {
    color: opts?.textColor ?? theme.textMuted,
    fontSize: 14,
    lineHeight: 22,
  };
  const mentionColor = opts?.mentionColor ?? '#4a9eff';
  const provinceMentionColor = opts?.provinceMentionColor ?? '#7cb342';
  const hashtagColor = opts?.hashtagColor ?? '#e8a838';
  const linkColor = opts?.linkColor ?? '#4a9eff';
  const parts = content.split(DISCUSSION_TOKEN_SPLIT_RE);
  return parts.map((part, index) => {
    if (/^@[a-zA-Z0-9_.-]+$/.test(part)) {
      const token = part.slice(1);
      const prov = getProvinceByMention(token);
      if (prov) {
        return (
          <Text
            key={index}
            style={[baseStyle, { color: provinceMentionColor, fontWeight: '700' }]}
            suppressHighlighting={false}
          >
            @{prov.mention}
          </Text>
        );
      }
      const username = token;
      return (
        <Text
          key={index}
          style={[baseStyle, { color: mentionColor, fontWeight: '700' }]}
          onPress={opts?.onMentionPress ? () => opts.onMentionPress?.(username) : undefined}
          suppressHighlighting={false}
        >
          {part}
        </Text>
      );
    }
    if (HASHTAG_BODY_RE.test(part)) {
      const tag = part.slice(1);
      return (
        <Text
          key={index}
          style={[baseStyle, { color: hashtagColor, fontWeight: '700' }]}
          onPress={opts?.onHashtagPress ? () => opts.onHashtagPress?.(tag) : undefined}
          suppressHighlighting={false}
        >
          {part}
        </Text>
      );
    }
    return <Text key={index}>{renderTextWithLinks(part, baseStyle, linkColor)}</Text>;
  });
}

const getAuthToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export type MentionSuggestion =
  | { type: 'user'; id: number; username: string; avatarUrl: string | null }
  | { type: 'province'; slug: string; mention: string; label: string };

export async function searchMentionSuggestions(query: string): Promise<MentionSuggestion[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const localProvinces = filterProvinceSuggestions(q, 5).map(p => ({
    type: 'province' as const,
    slug: p.slug,
    mention: p.mention,
    label: p.label,
  }));
  const token = await getAuthToken();
  if (!token) return localProvinces;
  try {
    const res = await fetch(`${API_URL}/api/profile/mentions/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return localProvinces;
    const data = await res.json();
    if (!Array.isArray(data)) return localProvinces;
    if (data.length > 0 && data[0]?.type) return data as MentionSuggestion[];
    return [
      ...localProvinces,
      ...data.map((u: { id: number; username: string; avatarUrl: string | null }) => ({
        type: 'user' as const,
        id: u.id,
        username: u.username,
        avatarUrl: u.avatarUrl,
      })),
    ];
  } catch {
    return localProvinces;
  }
}

/** @deprecated — użyj searchMentionSuggestions */
export async function searchMentionUsers(query: string): Promise<{ id: number; username: string; avatarUrl: string | null }[]> {
  const items = await searchMentionSuggestions(query);
  return items.filter((i): i is Extract<MentionSuggestion, { type: 'user' }> => i.type === 'user');
}

export async function resolveMentionUserId(username: string): Promise<number | null> {
  const clean = username.trim().replace(/^@+/, '');
  if (!clean) return null;
  const list = await searchMentionUsers(clean);
  const exact = list.find((u) => u.username.toLowerCase() === clean.toLowerCase());
  return exact?.id ?? null;
}

// ─────────────────────────────────────────────────────────
// LOADING VIEW
// ─────────────────────────────────────────────────────────
export const LoadingView = () => (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <ActivityIndicator color="#e33835" size="large" />
  </View>
);

// ─────────────────────────────────────────────────────────
// PHOTO VIEWER (fullscreen lightbox + pinch zoom)
// ─────────────────────────────────────────────────────────
const ZOOM_IMAGE_H = SCREEN_H * 0.75;

function ZoomablePhoto({ uri }: { uri: string }) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [uri]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ width: SCREEN_W, height: ZOOM_IMAGE_H }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      bouncesZoom
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Image
        source={{ uri }}
        style={{ width: SCREEN_W, height: ZOOM_IMAGE_H }}
        resizeMode="contain"
      />
    </ScrollView>
  );
}

export const PhotoViewer = ({
  photos,
  initialIndex = 0,
  visible,
  onClose,
  useOverlay = false,
}: {
  photos: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
  /** Gdy true — render jako overlay (bez Modal), np. wewnątrz innego Modala na iOS. */
  useOverlay?: boolean;
}) => {
  const [idx, setIdx] = useState(initialIndex);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) setIdx(initialIndex);
  }, [visible, initialIndex]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!visible || !photos.length) return null;

  const content = (
    <View style={{ flex: 1, backgroundColor: '#000000f0' }}>
      <TouchableOpacity
        onPress={handleClose}
        style={{
          position: 'absolute', top: insets.top + 14, right: 18, zIndex: 10,
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: '#ffffff18',
          justifyContent: 'center', alignItems: 'center',
        }}
      >
        <MaterialIcons name="close" size={22} color="#fff" />
      </TouchableOpacity>

      {photos.length > 1 && (
        <View style={{
          position: 'absolute', top: insets.top + 20, left: 0, right: 0,
          alignItems: 'center', zIndex: 10,
        }} pointerEvents="none">
          <View style={{
            backgroundColor: '#000000aa', borderRadius: 20,
            paddingHorizontal: 14, paddingVertical: 5,
          }}>
            <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 11, letterSpacing: 2 }}>
              {idx + 1} / {photos.length}
            </Text>
          </View>
        </View>
      )}

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ZoomablePhoto uri={photos[idx]} />
      </View>

      {photos.length > 1 && (
        <>
          <TouchableOpacity
            onPress={() => setIdx(i => (i - 1 + photos.length) % photos.length)}
            style={{
              position: 'absolute', left: 10, top: '50%',
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: '#ffffff20',
              justifyContent: 'center', alignItems: 'center', zIndex: 10,
            }}
          >
            <MaterialIcons name="chevron-left" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIdx(i => (i + 1) % photos.length)}
            style={{
              position: 'absolute', right: 10, top: '50%',
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: '#ffffff20',
              justifyContent: 'center', alignItems: 'center', zIndex: 10,
            }}
          >
            <MaterialIcons name="chevron-right" size={28} color="#fff" />
          </TouchableOpacity>
        </>
      )}

      {photos.length > 1 && (
        <View style={{
          flexDirection: 'row', justifyContent: 'center',
          gap: 8, paddingBottom: Math.max(insets.bottom, 24), paddingTop: 16,
        }}>
          {photos.map((uri, i) => (
            <TouchableOpacity key={i} onPress={() => setIdx(i)}>
              <Image
                source={{ uri }}
                style={{
                  width: 52, height: 52, borderRadius: 8,
                  borderWidth: 2,
                  borderColor: i === idx ? '#e33835' : '#ffffff30',
                  opacity: i === idx ? 1 : 0.5,
                }}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  if (useOverlay) {
    return (
      <View
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 1000, elevation: 1000,
        }}
      >
        {content}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
    >
      {content}
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────
// AVATAR
// ─────────────────────────────────────────────────────────
export const Avatar = ({ user, size = 40 }: { user: { username: string; avatarUrl: string | null }; size?: number }) => {
  const { theme, isDark } = useTheme();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      overflow: 'hidden',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(150, 150, 150, 0.2)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.25 : 0.08,
      shadowRadius: 4,
      elevation: 2,
    }}>
      {user.avatarUrl
        ? <Image source={{ uri: user.avatarUrl }} style={{ width: size, height: size }} resizeMode="cover" />
        : <Text style={{
            color: theme.primary,
            fontFamily: 'Orbitron',
            fontSize: size * 0.3,
            fontWeight: '700',
          }}>
            {user.username.slice(0, 2).toUpperCase()}
          </Text>
      }
    </View>
  );
};

// Wyrównanie mediów do treści posta w karcie dyskusji
export const POST_CONTENT_INSET = 16;
const POST_MEDIA_MAX_HEIGHT = 350;
const VIDEO_PLAYER_HEIGHT = Math.min(360, Math.round(SCREEN_W * 0.58));

function formatVideoTime(ms?: number | null): string {
  const totalSec = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function DiscussionVideoPlayer({ uri }: { uri: string }) {
  const { theme, isDark } = useTheme();
  const videoRef = useRef<Video>(null);
  const [status, setStatus] = useState<AVPlaybackStatus | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [progressTrackWidth, setProgressTrackWidth] = useState(0);

  const loaded: AVPlaybackStatusSuccess | null = status?.isLoaded === true ? status : null;
  const isPlaying = !!loaded?.isPlaying;
  const isBuffering = !!loaded?.isBuffering;
  const durationMs = loaded?.durationMillis ?? 0;
  const positionMs = loaded?.positionMillis ?? 0;
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  const finished = !!loaded?.didJustFinish || (durationMs > 0 && positionMs >= durationMs - 250);

  const togglePlayback = useCallback(async () => {
    const player = videoRef.current;
    if (!player) return;
    setHasStarted(true);
    try {
      if (finished) {
        await player.setPositionAsync(0);
        await player.playAsync();
        return;
      }
      if (isPlaying) await player.pauseAsync();
      else await player.playAsync();
    } catch {
      // best effort, status overlay will remain visible
    }
  }, [finished, isPlaying]);

  const handleProgressPress = useCallback(async (event: any) => {
    if (!loaded || durationMs <= 0) return;
    const width = progressTrackWidth;
    const x = Number(event?.nativeEvent?.locationX ?? 0);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(x)) return;
    try {
      await videoRef.current?.setPositionAsync(Math.min(1, Math.max(0, x / width)) * durationMs);
    } catch { /* ignore */ }
  }, [durationMs, loaded, progressTrackWidth]);

  useEffect(() => {
    const player = videoRef.current;
    return () => {
      player?.pauseAsync().catch(() => {});
    };
  }, []);

  return (
    <View style={{
      width: '100%',
      height: VIDEO_PLAYER_HEIGHT,
      maxHeight: POST_MEDIA_MAX_HEIGHT,
      backgroundColor: '#050505',
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    }}>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={false}
        isLooping={false}
        useNativeControls={false}
        progressUpdateIntervalMillis={250}
        onPlaybackStatusUpdate={setStatus}
      />

      {!hasStarted && (
        <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#0000002a' }]}>
          <View style={{
            position: 'absolute',
            top: 12,
            left: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: '#0000009a',
          }}>
            <MaterialIcons name="smart-display" size={15} color="#fff" />
            <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 9 }}>WIDEO</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={togglePlayback}
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: '#e33835',
              justifyContent: 'center',
              alignItems: 'center',
              shadowColor: '#e33835',
              shadowOpacity: 0.42,
              shadowRadius: 16,
              elevation: 8,
            }}
          >
            <MaterialIcons name="play-arrow" size={42} color="#fff" style={{ marginLeft: 3 }} />
          </TouchableOpacity>
        </View>
      )}

      {hasStarted && (
        <TouchableOpacity activeOpacity={1} onPress={togglePlayback} style={StyleSheet.absoluteFill}>
          {isBuffering && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ padding: 12, borderRadius: 999, backgroundColor: '#00000099' }}>
                <ActivityIndicator color="#fff" />
              </View>
            </View>
          )}
          {!isPlaying && !isBuffering && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name={finished ? 'replay' : 'play-arrow'} size={34} color="#fff" />
              </View>
            </View>
          )}
        </TouchableOpacity>
      )}

      <View style={{
        position: 'absolute',
        left: 10,
        right: 10,
        bottom: 10,
        borderRadius: 14,
        backgroundColor: '#000000b8',
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={togglePlayback}
            activeOpacity={0.75}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#ffffff18', justifyContent: 'center', alignItems: 'center' }}
          >
            <MaterialIcons name={isPlaying ? 'pause' : finished ? 'replay' : 'play-arrow'} size={22} color="#fff" />
          </TouchableOpacity>
          <Pressable
            onPress={handleProgressPress}
            onLayout={(event) => setProgressTrackWidth(event.nativeEvent.layout.width)}
            style={{ flex: 1, height: 32, justifyContent: 'center' }}
          >
            <View style={{ height: 4, borderRadius: 999, backgroundColor: '#ffffff2b', overflow: 'hidden' }}>
              <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: '#e33835' }} />
            </View>
          </Pressable>
          <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 9, minWidth: 76, textAlign: 'right' }}>
            {formatVideoTime(positionMs)} / {durationMs ? formatVideoTime(durationMs) : '--:--'}
          </Text>
        </View>
        {!loaded && (
          <Text style={{ color: theme.textDim, fontSize: 10, marginTop: 4 }}>
            Przygotowywanie odtwarzania...
          </Text>
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// MEDIA GRID — z podglądem po kliknięciu
// ─────────────────────────────────────────────────────────
export const MediaGrid = ({ photos, videos }: { photos: string[]; videos: string[] }) => {
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIdx,    setViewerIdx]    = useState(0);
  const [viewerOpen,   setViewerOpen]   = useState(false);

  if (!photos.length && !videos.length) return null;

  const openViewer = (uris: string[], idx: number) => {
    setViewerPhotos(uris);
    setViewerIdx(idx);
    setViewerOpen(true);
  };

  const photoCount = photos.length;
  const singlePhoto = photoCount === 1 && videos.length === 0;

  return (
    <>
      <View style={{
        marginHorizontal: POST_CONTENT_INSET,
        marginTop: 10,
        marginBottom: 10,
        borderRadius: 16,
        overflow: 'hidden',
        gap: videos.length > 0 && photoCount > 0 ? 8 : 0,
      }}>
        {videos.map((uri, i) => (
          <DiscussionVideoPlayer
            key={`v${i}`}
            uri={uri}
          />
        ))}
        {photoCount > 0 && (
          <View style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: photoCount > 1 ? 4 : 0,
            maxHeight: singlePhoto ? POST_MEDIA_MAX_HEIGHT : undefined,
            overflow: 'hidden',
          }}>
            {photos.map((uri, i) => {
              const total = photos.length;
              let w: any = '100%';
              let h = singlePhoto ? 280 : 220;
              if (total === 2) { w = '48.5%'; h = 150; }
              if (total === 3) { w = i === 0 ? '100%' : '48.5%'; h = i === 0 ? 170 : 110; }
              if (total >= 4) { w = '48.5%'; h = 120; }
              const isLast = total > 4 && i === 3;
              return (
                <TouchableOpacity
                  key={`p${i}`}
                  activeOpacity={0.88}
                  onPress={() => openViewer(photos, i)}
                  style={{
                    width: w,
                    height: h,
                    maxHeight: singlePhoto ? POST_MEDIA_MAX_HEIGHT : h,
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <Image
                    source={{ uri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                  {isLast && total > 4 && (
                    <View style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: '#000000bb',
                      justifyContent: 'center', alignItems: 'center',
                    }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: '#fff', fontWeight: '900' }}>
                        +{total - 4}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
      <PhotoViewer
        photos={viewerPhotos}
        initialIndex={viewerIdx}
        visible={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
};

// ─────────────────────────────────────────────────────────
// DELETE MODAL
// ─────────────────────────────────────────────────────────
export const DeleteModal = ({
  visible, onConfirm, onCancel,
}: { visible: boolean; onConfirm: () => void; onCancel: () => void }) => {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{
          backgroundColor: theme.surface, borderRadius: 24, padding: 28,
          width: '100%', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center',
        }}>
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: '#e3383518', justifyContent: 'center', alignItems: 'center', marginBottom: 16,
          }}>
            <MaterialIcons name="delete-forever" size={32} color="#e33835" />
          </View>
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>USUŃ POST</Text>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 24 }}>
            Czy na pewno chcesz usunąć ten post?{'\n'}
            <Text style={{ color: '#e33835' }}>Ta operacja jest nieodwracalna.</Text>
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <TouchableOpacity
              style={{
                flex: 1, backgroundColor: theme.surface2, borderRadius: 14,
                paddingVertical: 14, alignItems: 'center',
                borderWidth: 1, borderColor: theme.border2,
              }}
              onPress={onCancel}
            >
              <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11 }}>ANULUJ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                flex: 1, backgroundColor: '#e33835', borderRadius: 14,
                paddingVertical: 14, alignItems: 'center',
                flexDirection: 'row', justifyContent: 'center', gap: 6,
              }}
              onPress={onConfirm}
            >
              <MaterialIcons name="delete" size={15} color="#fff" />
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11 }}>USUŃ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────
// ACTION BTN
// ─────────────────────────────────────────────────────────
export const ActionBtn = ({
  icon, count, active, activeColor = '#e33835', onPress,
}: { icon: string; count: number; active: boolean; activeColor?: string; onPress: () => void }) => {
  const { theme, isDark } = useTheme();
  const chipBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14,
        backgroundColor: active ? `${activeColor}22` : chipBg,
      }}
    >
      <MaterialCommunityIcons
        name={icon as any}
        size={16}
        color={active ? activeColor : theme.textDim}
      />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: active ? activeColor : theme.textDim }}>{count}</Text>
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────────
// REACTION CHIPS (dyskusje)
// ─────────────────────────────────────────────────────────
export const ReactionChips = ({
  reactions,
  onToggle,
}: {
  reactions?: DiscussionReaction[];
  onToggle: (emoji: string) => void;
}) => {
  const { theme, isDark } = useTheme();
  if (!reactions?.length) return null;
  const chipBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {reactions.map(r => (
        <TouchableOpacity
          key={r.emoji}
          onPress={() => onToggle(r.emoji)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 3,
            backgroundColor: r.myReaction ? (isDark ? '#e3383528' : '#e3383518') : chipBg,
            borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
          <Text style={{ fontSize: 10, color: r.myReaction ? theme.primary : theme.textDim, fontFamily: 'Orbitron', fontWeight: '700' }}>
            {r.count}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

// ─────────────────────────────────────────────────────────
// STAT PILL
// ─────────────────────────────────────────────────────────
export const StatPill = ({ icon, value, color }: { icon: string; value: string; color?: string }) => {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <MaterialIcons name={icon as any} size={10} color={color ?? theme.textDim} />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{value}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────
// FOOTER LOADER
// ─────────────────────────────────────────────────────────
export const ListFooter = ({ loading }: { loading: boolean }) => {
  if (!loading) return null;
  return <ActivityIndicator color="#e33835" style={{ padding: 20 }} />;
};

// ─────────────────────────────────────────────────────────
// DISCUSSION POLL (post card)
// ─────────────────────────────────────────────────────────
const POLL_ACCENT = '#a855f7';

export const DiscussionPollCard = ({
  postId, poll, onVote,
}: {
  postId: number;
  poll: PostPollData;
  onVote: (postId: number, optionIdx: number) => Promise<PostPollData | null>;
}) => {
  const { theme, isDark } = useTheme();
  const [local, setLocal] = useState(poll);
  const [selected, setSelected] = useState<number | null>(poll.myVote);
  const [voting, setVoting] = useState(false);

  useEffect(() => { setLocal(poll); setSelected(poll.myVote); }, [poll]);

  const total = local.voteCounts.reduce((a, b) => a + b, 0) || 1;
  const showResults = local.myVote !== null;

  const handleVote = async () => {
    if (selected === null || local.myVote !== null || voting) return;
    setVoting(true);
    const updated = await onVote(postId, selected);
    if (updated) setLocal(updated);
    setVoting(false);
  };

  return (
    <View style={{
      marginHorizontal: POST_CONTENT_INSET,
      marginTop: 2,
      marginBottom: 12,
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: `${POLL_ACCENT}35`,
      backgroundColor: isDark ? '#ffffff06' : '#00000004',
    }}>
      <View style={{ height: 2, backgroundColor: POLL_ACCENT }} />
      <View style={{ paddingHorizontal: 12, paddingVertical: 11 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text, lineHeight: 20, marginBottom: 10 }} numberOfLines={3}>
          {local.question}
        </Text>
        {local.options.map((option, i) => {
          const pct    = Math.round((local.voteCounts[i] / total) * 100);
          const active = local.myVote === i || (!showResults && selected === i);
          const letter = String.fromCharCode(65 + i);
          return (
            <TouchableOpacity
              key={i}
              disabled={showResults}
              onPress={() => !showResults && setSelected(i)}
              activeOpacity={0.88}
              style={{
                marginBottom: i < local.options.length - 1 ? 5 : 0,
                borderRadius: 10, overflow: 'hidden',
                borderWidth: 1,
                borderColor: active ? `${POLL_ACCENT}70` : (isDark ? '#ffffff10' : '#0000000c'),
                backgroundColor: active ? `${POLL_ACCENT}12` : (isDark ? '#ffffff04' : '#00000003'),
              }}
            >
              {showResults && (
                <View style={{
                  position: 'absolute', top: 0, left: 0, bottom: 0,
                  width: `${Math.max(pct, local.myVote === i ? 8 : 4)}%`,
                  backgroundColor: local.myVote === i ? `${POLL_ACCENT}22` : (isDark ? '#ffffff08' : '#00000006'),
                }} />
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 9, gap: 8 }}>
                <View style={{
                  width: 20, height: 20, borderRadius: 6,
                  backgroundColor: active ? POLL_ACCENT : (isDark ? '#ffffff12' : '#0000000a'),
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: active ? '#fff' : theme.textDim }}>{letter}</Text>
                </View>
                <Text
                  numberOfLines={2}
                  style={{ flex: 1, fontSize: 12.5, lineHeight: 17, color: active ? theme.text : theme.textMuted, fontWeight: active ? '600' : '400' }}
                >
                  {option}
                </Text>
                {showResults && (
                  <View style={{ alignItems: 'flex-end', minWidth: 32 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: local.myVote === i ? POLL_ACCENT : theme.textDim }}>{pct}%</Text>
                    <Text style={{ fontSize: 9, color: theme.textDim, marginTop: 1 }}>{local.voteCounts[i]}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        {showResults ? (
          <Text style={{ fontSize: 10, color: theme.textDim, textAlign: 'center', marginTop: 9 }}>
            {local.totalVotes} {local.totalVotes === 1 ? 'głos' : local.totalVotes < 5 ? 'głosy' : 'głosów'}
          </Text>
        ) : (
          <TouchableOpacity
            onPress={handleVote}
            disabled={selected === null || voting}
            style={{
              marginTop: 10, borderRadius: 10, backgroundColor: POLL_ACCENT,
              paddingVertical: 9, alignItems: 'center',
              opacity: selected === null || voting ? 0.4 : 1,
            }}
          >
            {voting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>Zagłosuj</Text>
            }
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────
// COMPOSE BOX
// ─────────────────────────────────────────────────────────
export const ComposeBox = ({
  onPost,
  bottomInset,
  defaultCategory,
  mentionsEnabled = false,
  onHeightChange,
  isPremium = false,
  isAdmin = false,
  onUpgradePremium,
}: {
  onPost: (
    text: string,
    photos: string[],
    video: string | null,
    category: DiscussionCategoryId,
    poll?: PostPollInput | null,
  ) => Promise<void>;
  bottomInset: number;
  defaultCategory?: DiscussionCategoryId;
  /** Podpowiedzi @username przy pisaniu posta */
  mentionsEnabled?: boolean;
  /** Raportuje wysokość paska (FlatList paddingBottom). */
  onHeightChange?: (height: number) => void;
  isPremium?: boolean;
  isAdmin?: boolean;
  onUpgradePremium?: () => void;
}) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const pillBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const pillSolidBg = isDark ? 'rgba(15, 15, 15, 0.95)' : 'rgba(250, 250, 250, 0.95)';
  const pillShadow = Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.5,
      shadowRadius: 10,
    },
    android: { elevation: 10 },
    default: {},
  });
  const [text,    setText]    = useState('');
  const [inputH,  setInputH]  = useState(50);
  const [photos,  setPhotos]  = useState<string[]>([]);
  const [video,   setVideo]   = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [photoViewer, setPhotoViewer] = useState(false);
  const [photoIdx,    setPhotoIdx]    = useState(0);
  const [mentionUsers, setMentionUsers] = useState<MentionSuggestion[]>([]);
  const [pollModal, setPollModal] = useState(false);
  const [pollDraft, setPollDraft] = useState<PostPollInput | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<DiscussionCategoryId | null>(defaultCategory ?? null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardInset = useKeyboardInset();
  const pollKeyboardInset = useKeyboardInset(pollModal);

  const pickPhoto = async () => {
    if (photos.length >= 4 || video) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85, allowsMultipleSelection: true, selectionLimit: 4 - photos.length,
    });
    if (!r.canceled) {
      const uris = r.assets.map(a => a.uri);
      setPhotos(prev => [...prev, ...uris].slice(0, 4));
    }
  };
  const pickVideo = async () => {
    if (photos.length > 0 || video) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 60,
    });
    if (!r.canceled && r.assets[0]) {
      const fileSize = Number((r.assets[0] as any).fileSize ?? 0);
      const maxBytes = isAdmin ? null : (isPremium ? 120 * 1024 * 1024 : 20 * 1024 * 1024);
      if (maxBytes !== null && fileSize > maxBytes) {
        if (!isPremium && !isAdmin) {
          Toast.show({
            type: 'error',
            text1: 'Plik za duży',
            text2: 'Odblokuj Premium, aby wysyłać filmy do 120MB',
          });
          onUpgradePremium?.();
          return;
        }
        Toast.show({ type: 'error', text1: 'Film za duży', text2: 'Maksymalnie 120MB dla Premium' });
        return;
      }
      setVideo(r.assets[0].uri);
    }
  };

  const canSend = text.trim().length > 0 || photos.length > 0 || !!video || !!pollDraft;

  const openPollEditor = () => {
    if (pollDraft) {
      setPollQuestion(pollDraft.question);
      setPollOptions([...pollDraft.options]);
    } else {
      setPollQuestion('');
      setPollOptions(['', '']);
    }
    setPollModal(true);
  };

  const savePollDraft = () => {
    const question = pollQuestion.trim();
    const options = pollOptions.map(o => o.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      Toast.show({ type: 'error', text1: 'Ankieta', text2: 'Pytanie i min. 2 opcje' });
      return;
    }
    if (options.length > 6) {
      Toast.show({ type: 'error', text1: 'Maks. 6 opcji' });
      return;
    }
    setPollDraft({ question, options });
    setPollModal(false);
  };

  const handleSend = async () => {
    if (!canSend) return;
    if (!selectedCategory) {
      Toast.show({ type: 'error', text1: 'Wybierz kategorię posta' });
      return;
    }
    setPosting(true);
    await onPost(text.trim(), photos, video, selectedCategory, pollDraft);
    setText(''); setPhotos([]); setVideo(null); setPollDraft(null);
    setPosting(false); setFocused(false);
    setMentionUsers([]);
    Keyboard.dismiss();
  };

  const restingBottom = Math.max(bottomInset, insets.bottom, 8);
  /** marginBottom podnosi cały pasek nad klawiaturę (paddingBottom tego nie robi). */
  const keyboardLift = keyboardInset > 0 ? keyboardInset + 12 : 0;

  const onChangeText = (v: string) => {
    setText(v);
    if (!mentionsEnabled) return;
    const match = v.match(/(?:^|\s)@([a-zA-Z0-9_.-]{1,32})$/);
    const q = match ? match[1] : null;
    if (mentionTimer.current) clearTimeout(mentionTimer.current);
    if (!q) {
      setMentionUsers([]);
      return;
    }
    mentionTimer.current = setTimeout(async () => {
      const list = await searchMentionSuggestions(q);
      setMentionUsers(list);
    }, 220);
  };

  const insertMention = (item: MentionSuggestion) => {
    const tag = item.type === 'province' ? item.mention : item.username;
    setText(prev => prev.replace(/@([a-zA-Z0-9_.-]*)$/, `@${tag} `));
    setMentionUsers([]);
  };

  const pillHeight = Math.min(Math.max(50, inputH), 60);

  return (
    <View
      onLayout={e => onHeightChange?.(e.nativeEvent.layout.height)}
      style={{
        paddingBottom: restingBottom,
        marginBottom: keyboardLift,
      }}
    >
      {pollDraft && (
        <View style={{
          marginHorizontal: 16, marginBottom: 8, borderRadius: 12,
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          padding: 10,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{
              width: 26, height: 26, borderRadius: 8, backgroundColor: `${POLL_ACCENT}18`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="poll" size={15} color={POLL_ACCENT} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{pollDraft.question}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} contentContainerStyle={{ gap: 5 }}>
                {pollDraft.options.map((opt, i) => (
                  <View
                    key={i}
                    style={{
                      maxWidth: 120, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                      backgroundColor: `${POLL_ACCENT}10`, borderWidth: 1, borderColor: `${POLL_ACCENT}25`,
                    }}
                  >
                    <Text style={{ fontSize: 10, color: theme.textMuted }} numberOfLines={1}>{opt}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <TouchableOpacity onPress={openPollEditor} hitSlop={10} style={{ padding: 4 }}>
                <MaterialIcons name="edit" size={17} color={theme.textDim} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPollDraft(null)} hitSlop={10} style={{ padding: 4 }}>
                <MaterialIcons name="close" size={17} color="#e33835" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {(photos.length > 0 || video) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: 16, marginBottom: 8 }} contentContainerStyle={{ gap: 8 }}>
          {video && (
            <View style={{ position: 'relative' }}>
              <Video source={{ uri: video }} style={{ width: 64, height: 64, borderRadius: 12 }} resizeMode={ResizeMode.COVER} shouldPlay={false} />
              <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: '#000000cc', borderRadius: 6, padding: 2 }}>
                <MaterialIcons name="videocam" size={10} color="#fff" />
              </View>
              <TouchableOpacity
                style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#e33835', borderRadius: 9, width: 18, height: 18, justifyContent: 'center', alignItems: 'center' }}
                onPress={() => setVideo(null)}
              >
                <MaterialIcons name="close" size={11} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
          {photos.map((uri, i) => (
            <TouchableOpacity key={i} onPress={() => { setPhotoIdx(i); setPhotoViewer(true); }}>
              <View style={{ position: 'relative' }}>
                <Image source={{ uri }} style={{ width: 64, height: 64, borderRadius: 12 }} resizeMode="cover" />
                <TouchableOpacity
                  style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#e33835', borderRadius: 9, width: 18, height: 18, justifyContent: 'center', alignItems: 'center' }}
                  onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                >
                  <MaterialIcons name="close" size={11} color="#fff" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {mentionsEnabled && mentionUsers.length > 0 && (
        <View style={{
          marginHorizontal: 16, marginBottom: 8, maxHeight: 140, borderRadius: 14,
          backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {mentionUsers.map(u => (
              <TouchableOpacity
                key={u.type === 'province' ? `p-${u.slug}` : `u-${u.id}`}
                onPress={() => insertMention(u)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}
              >
                {u.type === 'user' ? (
                  <Avatar user={u} size={30} />
                ) : (
                  <View style={{
                    width: 30, height: 30, borderRadius: 15, backgroundColor: '#7cb34222',
                    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#7cb34255',
                  }}>
                    <MaterialIcons name="map" size={16} color="#7cb342" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13 }}>
                    {u.type === 'province' ? `@${u.mention}` : u.username}
                  </Text>
                  {u.type === 'province' && (
                    <Text style={{ color: theme.textDim, fontSize: 10, marginTop: 2 }}>{u.label}</Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={{ marginHorizontal: 16, marginBottom: 16, ...pillShadow }}>
        <View style={{
          height: pillHeight,
          borderRadius: 25,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: pillBorder,
        }}>
          <BlurView
            intensity={100}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFillObject}
          />
          <View
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: pillSolidBg },
            ]}
          />
          <View style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: 16,
            paddingRight: 6,
            gap: 8,
          }}>
          <TextInput
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              borderWidth: 0,
              color: theme.text,
              fontSize: 14,
              lineHeight: 18,
              paddingVertical: 0,
              maxHeight: 44,
            }}
            value={text}
            onChangeText={mentionsEnabled ? onChangeText : setText}
            onContentSizeChange={e => setInputH(e.nativeEvent.contentSize.height + 28)}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); if (mentionsEnabled) setTimeout(() => setMentionUsers([]), 200); }}
            placeholder="Co słychać w garażu?"
            placeholderTextColor={theme.textDim}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: theme.primary,
              justifyContent: 'center', alignItems: 'center',
              opacity: canSend ? 1 : 0.35,
            }}
            onPress={handleSend}
            disabled={posting || !canSend}
          >
            {posting
              ? <ActivityIndicator size={14} color="#fff" />
              : <MaterialIcons name="send" size={16} color="#fff" />
            }
          </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={{ marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <TouchableOpacity onPress={() => setCategoryModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <MaterialIcons
            name={selectedCategory ? (getDiscussionCategoryMeta(selectedCategory).icon as any) : 'category'}
            size={14}
            color={selectedCategory ? theme.primary : theme.textDim}
          />
          <Text style={{ color: selectedCategory ? theme.primary : theme.textDim, fontSize: 11 }}>
            {selectedCategory ? getDiscussionCategoryMeta(selectedCategory).label : 'Kategoria'}
          </Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <TouchableOpacity onPress={pickPhoto} disabled={photos.length >= 4 || !!video} hitSlop={8}>
            <MaterialIcons name="add-photo-alternate" size={18} color={photos.length >= 4 || !!video ? theme.textDim : theme.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={pickVideo} disabled={photos.length > 0 || !!video || !!pollDraft} hitSlop={8}>
            <MaterialIcons name="videocam" size={18} color={photos.length > 0 || !!video || pollDraft ? theme.textDim : theme.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openPollEditor} disabled={!!video || photos.length > 0} hitSlop={8}>
            <MaterialCommunityIcons name="poll" size={18} color={video || photos.length > 0 ? theme.textDim : (pollDraft ? POLL_ACCENT : theme.textMuted)} />
          </TouchableOpacity>
        </View>
      </View>

      <PhotoViewer
        photos={photos}
        initialIndex={photoIdx}
        visible={photoViewer}
        onClose={() => setPhotoViewer(false)}
      />

      <Modal visible={pollModal} transparent animationType="slide" onRequestClose={() => setPollModal(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          enabled={Platform.OS === 'ios'}
        >
          <Pressable style={{ flex: 1, backgroundColor: '#000000aa' }} onPress={() => setPollModal(false)} />
          <View style={{
            backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
            borderWidth: 1, borderColor: theme.border,
            maxHeight: SCREEN_H * 0.72,
            paddingBottom: pollKeyboardInset > 0
              ? pollKeyboardInset + 8
              : Math.max(insets.bottom, 14),
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 10, marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Ankieta</Text>
              <TouchableOpacity onPress={() => setPollModal(false)} hitSlop={12}>
                <MaterialIcons name="close" size={22} color={theme.textDim} />
              </TouchableOpacity>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
            >
              <Text style={{ fontSize: 11, color: theme.textDim, marginBottom: 6 }}>Pytanie</Text>
              <TextInput
                value={pollQuestion}
                onChangeText={setPollQuestion}
                placeholder="O co chcesz zapytać?"
                placeholderTextColor={theme.textDim}
                maxLength={200}
                style={{
                  backgroundColor: theme.surface2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
                  color: theme.text, fontSize: 14, marginBottom: 14,
                  borderWidth: 1, borderColor: theme.border,
                }}
              />
              <Text style={{ fontSize: 11, color: theme.textDim, marginBottom: 8 }}>Opcje ({pollOptions.length}/6)</Text>
              {pollOptions.map((opt, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <View style={{
                    width: 22, height: 22, borderRadius: 6, backgroundColor: `${POLL_ACCENT}18`,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: POLL_ACCENT }}>{String.fromCharCode(65 + i)}</Text>
                  </View>
                  <TextInput
                    value={opt}
                    onChangeText={v => setPollOptions(prev => prev.map((o, j) => j === i ? v : o))}
                    placeholder={`Opcja ${String.fromCharCode(65 + i)}`}
                    placeholderTextColor={theme.textDim}
                    maxLength={80}
                    style={{
                      flex: 1, backgroundColor: theme.surface2, borderRadius: 10,
                      paddingHorizontal: 10, paddingVertical: 8,
                      color: theme.text, fontSize: 13, borderWidth: 1, borderColor: theme.border,
                    }}
                  />
                  {pollOptions.length > 2 && (
                    <TouchableOpacity onPress={() => setPollOptions(prev => prev.filter((_, j) => j !== i))} hitSlop={8}>
                      <MaterialIcons name="close" size={18} color={theme.textDim} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {pollOptions.length < 6 && (
                <TouchableOpacity
                  onPress={() => setPollOptions(prev => [...prev, ''])}
                  style={{
                    alignSelf: 'flex-start', marginTop: 4, marginBottom: 4,
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                    borderWidth: 1, borderColor: `${POLL_ACCENT}40`, borderStyle: 'dashed',
                  }}
                >
                  <Text style={{ fontSize: 12, color: POLL_ACCENT, fontWeight: '600' }}>+ Opcja</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
              <TouchableOpacity
                onPress={savePollDraft}
                style={{ backgroundColor: POLL_ACCENT, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 13, color: '#fff', fontWeight: '700' }}>Dodaj do posta</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={categoryModal} transparent animationType="fade" onRequestClose={() => setCategoryModal(false)}>
        <Pressable
          onPress={() => setCategoryModal(false)}
          style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              borderWidth: 1,
              borderColor: theme.border,
              paddingHorizontal: 14,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 12),
              gap: 8,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 2 }}>Kategoria posta</Text>
            {DISCUSSION_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                onPress={() => {
                  setSelectedCategory(cat.id);
                  setCategoryModal(false);
                }}
                style={{
                  borderRadius: 12,
                  backgroundColor: selectedCategory === cat.id
                    ? (isDark ? 'rgba(227,56,53,0.12)' : 'rgba(227,56,53,0.08)')
                    : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <MaterialIcons name={cat.icon as any} size={16} color={selectedCategory === cat.id ? theme.primary : theme.textDim} />
                <Text style={{ color: theme.text, fontSize: 13 }}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};
