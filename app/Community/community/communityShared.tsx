import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Linking, TouchableOpacity, TextInput,
  Image, ActivityIndicator, Modal, ScrollView, Dimensions,
  Animated, Platform, Keyboard, KeyboardAvoidingView, Pressable,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import { Video, ResizeMode }  from 'expo-av';
import Toast                  from 'react-native-toast-message';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets }  from 'react-native-safe-area-context';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';
import { useKeyboardInset }   from '../../../hooks/useKeyboardInset';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────
export interface Author       { id: number; username: string; avatarUrl: string | null; points: number; isPremium?: boolean; nickColor?: string | null; }
export interface Comment      { id: number; content: string; photos: string[]; createdAt: string; author: Author; replyTo?: { id: number; username: string } | null; }
export interface PostPollData {
  id: number; question: string; options: string[];
  voteCounts: number[]; totalVotes: number; myVote: number | null;
}
export interface PostPollInput { question: string; options: string[]; }
export interface Post         { id: number; content: string; photos: string[]; videos: string[]; createdAt: string; author: Author; likesCount: number; commentsCount: number; repostsCount: number; isLiked: boolean; isReposted: boolean; poll?: PostPollData | null; }
export interface PublicRoute  { id: number; name: string; description: string | null; distance: number; isPublic: boolean; createdAt: string; author: { id: number; username: string; avatarUrl: string | null }; points: { latitude: number; longitude: number; order: number }[]; likesCount: number; isLiked: boolean; _count?: { likes: number }; runsCount?: number; }
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

/** Tekst dyskusji / komentarzy / czatu: @wzmianki + linki w pozostałych fragmentach */
export function renderDiscussionBody(
  content: string,
  theme: { textMuted: string },
  opts?: {
    textColor?: string;
    mentionColor?: string;
    linkColor?: string;
    onMentionPress?: (username: string) => void;
  },
) {
  const baseStyle = {
    color: opts?.textColor ?? theme.textMuted,
    fontSize: 14,
    lineHeight: 22,
  };
  const mentionColor = opts?.mentionColor ?? '#4a9eff';
  const linkColor = opts?.linkColor ?? '#4a9eff';
  const parts = content.split(/(@[a-zA-Z0-9_.-]+)/g);
  return parts.map((part, index) => {
    if (/^@[a-zA-Z0-9_.-]+$/.test(part)) {
      const username = part.slice(1);
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
    return <Text key={index}>{renderTextWithLinks(part, baseStyle, linkColor)}</Text>;
  });
}

const getAuthToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export async function searchMentionUsers(query: string): Promise<{ id: number; username: string; avatarUrl: string | null }[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const token = await getAuthToken();
  if (!token) return [];
  try {
    const res = await fetch(`${API_URL}/api/profile/mentions/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
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
// PHOTO VIEWER (fullscreen lightbox)
// ─────────────────────────────────────────────────────────
export const PhotoViewer = ({
  photos,
  initialIndex = 0,
  visible,
  onClose,
}: {
  photos: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
}) => {
  const [idx, setIdx] = useState(initialIndex);
  const fadeAnim      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setIdx(initialIndex);
      Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      fadeAnim.setValue(0);
    }
  }, [visible, initialIndex]);

  if (!visible || !photos.length) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={{ flex: 1, backgroundColor: '#000000f0', opacity: fadeAnim }}>
        {/* Zamknij */}
        <TouchableOpacity
          onPress={onClose}
          style={{
            position: 'absolute', top: 54, right: 18, zIndex: 10,
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: '#ffffff18',
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <MaterialIcons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Licznik */}
        {photos.length > 1 && (
          <View style={{
            position: 'absolute', top: 60, left: 0, right: 0,
            alignItems: 'center', zIndex: 10,
          }}>
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

        {/* Główne zdjęcie */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 0 }}>
          <Image
            source={{ uri: photos[idx] }}
            style={{ width: SCREEN_W, height: SCREEN_H * 0.75 }}
            resizeMode="contain"
          />
        </View>

        {/* Strzałki nawigacji */}
        {photos.length > 1 && (
          <>
            <TouchableOpacity
              onPress={() => setIdx(i => (i - 1 + photos.length) % photos.length)}
              style={{
                position: 'absolute', left: 10, top: '50%',
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: '#ffffff20',
                justifyContent: 'center', alignItems: 'center',
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
                justifyContent: 'center', alignItems: 'center',
              }}
            >
              <MaterialIcons name="chevron-right" size={28} color="#fff" />
            </TouchableOpacity>
          </>
        )}

        {/* Thumbnail strip */}
        {photos.length > 1 && (
          <View style={{
            flexDirection: 'row', justifyContent: 'center',
            gap: 8, paddingBottom: 40, paddingTop: 16,
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
      </Animated.View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────
// AVATAR
// ─────────────────────────────────────────────────────────
export const Avatar = ({ user, size = 40 }: { user: { username: string; avatarUrl: string | null }; size?: number }) => {
  const { theme } = useTheme();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      overflow: 'hidden',
      backgroundColor: '#e3383518',
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1.5, borderColor: '#e3383530',
    }}>
      {user.avatarUrl
        ? <Image source={{ uri: user.avatarUrl }} style={{ width: size, height: size }} resizeMode="cover" />
        : <Text style={{
            color: '#e33835',
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

  return (
    <>
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 3,
        marginBottom: 10, borderRadius: 14, overflow: 'hidden',
      }}>
        {videos.map((uri, i) => (
          <Video
            key={`v${i}`} source={{ uri }}
            style={{ width: '100%', height: 200, borderRadius: 12 }}
            resizeMode={ResizeMode.COVER} useNativeControls isLooping={false}
          />
        ))}
        {photos.map((uri, i) => {
          const total = photos.length;
          let w: any = '100%';
          let h = 220;
          if (total === 2) { w = '49.5%'; h = 150; }
          if (total === 3) { w = i === 0 ? '100%' : '49.5%'; h = i === 0 ? 170 : 110; }
          if (total >= 4) { w = '49.5%'; h = 120; }
          const isLast = total > 4 && i === 3;
          return (
            <TouchableOpacity
              key={`p${i}`}
              activeOpacity={0.88}
              onPress={() => openViewer(photos, i)}
              style={{ width: w, height: h, borderRadius: total === 1 ? 14 : 4, overflow: 'hidden', position: 'relative' }}
            >
              <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              {isLast && total > 4 && (
                <View style={{ position: 'absolute', inset: 0, backgroundColor: '#000000bb', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: '#fff', fontWeight: '900' }}>+{total - 4}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
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
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 5, paddingVertical: 7, borderRadius: 10,
        backgroundColor: active ? `${activeColor}15` : 'transparent',
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
      marginHorizontal: 14, marginBottom: 12,
      borderRadius: 14, overflow: 'hidden',
      borderWidth: 1, borderColor: `${POLL_ACCENT}35`,
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
  mentionsEnabled = false,
  onHeightChange,
}: {
  onPost: (text: string, photos: string[], video: string | null, poll?: PostPollInput | null) => Promise<void>;
  bottomInset: number;
  /** Podpowiedzi @username przy pisaniu posta */
  mentionsEnabled?: boolean;
  /** Raportuje wysokość paska (FlatList paddingBottom). */
  onHeightChange?: (height: number) => void;
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [text,    setText]    = useState('');
  const [photos,  setPhotos]  = useState<string[]>([]);
  const [video,   setVideo]   = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [photoViewer, setPhotoViewer] = useState(false);
  const [photoIdx,    setPhotoIdx]    = useState(0);
  const [mentionUsers, setMentionUsers] = useState<{ id: number; username: string; avatarUrl: string | null }[]>([]);
  const [pollModal, setPollModal] = useState(false);
  const [pollDraft, setPollDraft] = useState<PostPollInput | null>(null);
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
      if (((r.assets[0] as any).fileSize ?? 0) > 20 * 1024 * 1024) {
        Toast.show({ type: 'error', text1: 'Film za duży', text2: 'Maksymalnie 20MB' });
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
    setPosting(true);
    await onPost(text.trim(), photos, video, pollDraft);
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
      const list = await searchMentionUsers(q);
      setMentionUsers(list);
    }, 220);
  };

  const insertMention = (username: string) => {
    setText(prev => prev.replace(/@([a-zA-Z0-9_.-]*)$/, `@${username} `));
    setMentionUsers([]);
  };

  return (
    <View
      onLayout={e => onHeightChange?.(e.nativeEvent.layout.height)}
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.surface,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: restingBottom,
        marginBottom: keyboardLift,
      }}
    >
      {pollDraft && (
        <View style={{
          marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: `${POLL_ACCENT}30`,
          backgroundColor: theme.surface2, padding: 10,
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

      {/* Podgląd mediów */}
      {(photos.length > 0 || video) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 8 }}>
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
          marginBottom: 8, maxHeight: 140, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
          backgroundColor: theme.surface2, overflow: 'hidden',
        }}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {mentionUsers.map(u => (
              <TouchableOpacity
                key={u.id}
                onPress={() => insertMention(u.username)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}
              >
                <Avatar user={u} size={30} />
                <Text style={{ color: theme.text, fontSize: 13 }}>{u.username}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <TextInput
          style={{
            flex: 1,
            backgroundColor: theme.surface2,
            borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
            color: theme.text, fontSize: 14, maxHeight: 100, minHeight: 42,
            borderWidth: 1, borderColor: focused ? '#e3383540' : theme.border,
          }}
          value={text}
          onChangeText={mentionsEnabled ? onChangeText : setText}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (mentionsEnabled) setTimeout(() => setMentionUsers([]), 200); }}
          placeholder="Co słychać w garażu?"
          placeholderTextColor={theme.textDim}
          multiline maxLength={500}
        />
        <TouchableOpacity
          style={[{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: '#e33835',
            justifyContent: 'center', alignItems: 'center',
          }, !canSend && { opacity: 0.3 }]}
          onPress={handleSend}
          disabled={posting || !canSend}
        >
          {posting
            ? <ActivityIndicator size={14} color="#fff" />
            : <MaterialIcons name="send" size={17} color="#fff" />
          }
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 8, paddingLeft: 2, paddingBottom: 2 }}>
        <TouchableOpacity onPress={pickPhoto} disabled={photos.length >= 4 || !!video} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <MaterialIcons name="add-photo-alternate" size={20} color={photos.length >= 4 || !!video ? theme.textDim : '#e33835'} />
          <Text style={{ fontSize: 11, color: photos.length >= 4 || !!video ? theme.textDim : theme.textMuted }}>Zdjęcie</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={pickVideo} disabled={photos.length > 0 || !!video || !!pollDraft} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <MaterialIcons name="videocam" size={20} color={photos.length > 0 || !!video || pollDraft ? theme.textDim : theme.textMuted} />
          <Text style={{ fontSize: 11, color: photos.length > 0 || !!video || pollDraft ? theme.textDim : theme.textMuted }}>Film</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openPollEditor} disabled={!!video || photos.length > 0} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <MaterialCommunityIcons name="poll" size={20} color={video || photos.length > 0 ? theme.textDim : (pollDraft ? POLL_ACCENT : theme.textMuted)} />
          <Text style={{ fontSize: 11, color: video || photos.length > 0 ? theme.textDim : (pollDraft ? POLL_ACCENT : theme.textMuted) }}>Ankieta</Text>
        </TouchableOpacity>
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
    </View>
  );
};
