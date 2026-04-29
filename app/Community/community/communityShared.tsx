import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Linking, TouchableOpacity, TextInput,
  Image, ActivityIndicator, Modal, ScrollView, Dimensions,
  Animated, Platform,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import { Video, ResizeMode }  from 'expo-av';
import Toast                  from 'react-native-toast-message';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────
export interface Author       { id: number; username: string; avatarUrl: string | null; points: number; isPremium?: boolean; nickColor?: string | null; }
export interface Comment      { id: number; content: string; photos: string[]; createdAt: string; author: Author; replyTo?: { id: number; username: string } | null; }
export interface Post         { id: number; content: string; photos: string[]; videos: string[]; createdAt: string; author: Author; likesCount: number; commentsCount: number; repostsCount: number; isLiked: boolean; isReposted: boolean; }
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
  opts?: { textColor?: string; mentionColor?: string; linkColor?: string },
) {
  const baseStyle = {
    color: opts?.textColor ?? theme.textMuted,
    fontSize: 14,
    lineHeight: 22,
  };
  const mentionColor = opts?.mentionColor ?? '#4a9eff';
  const linkColor = opts?.linkColor ?? '#4a9eff';
  const parts = content.split(/(@[a-zA-Z0-9_.-]{2,32})/g);
  return parts.map((part, index) => {
    if (part.startsWith('@')) {
      return (
        <Text key={index} style={[baseStyle, { color: mentionColor, fontWeight: '700' }]}>
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
// COMPOSE BOX
// ─────────────────────────────────────────────────────────
export const ComposeBox = ({
  onPost,
  bottomInset,
  mentionsEnabled = false,
}: {
  onPost: (text: string, photos: string[], video: string | null) => Promise<void>;
  bottomInset: number;
  /** Podpowiedzi @username przy pisaniu posta */
  mentionsEnabled?: boolean;
}) => {
  const { theme } = useTheme();
  const [text,    setText]    = useState('');
  const [photos,  setPhotos]  = useState<string[]>([]);
  const [video,   setVideo]   = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [photoViewer, setPhotoViewer] = useState(false);
  const [photoIdx,    setPhotoIdx]    = useState(0);
  const [mentionUsers, setMentionUsers] = useState<{ id: number; username: string; avatarUrl: string | null }[]>([]);
  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const canSend = text.trim().length > 0 || photos.length > 0 || !!video;

  const handleSend = async () => {
    if (!canSend) return;
    setPosting(true);
    await onPost(text.trim(), photos, video);
    setText(''); setPhotos([]); setVideo(null);
    setPosting(false); setFocused(false);
    setMentionUsers([]);
  };

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
    <View style={{
      borderTopWidth: 1, borderTopColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: Math.max(bottomInset, 10),
    }}>
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
        {/* Przyciski mediów */}
        <View style={{ flexDirection: 'column', gap: 8, paddingBottom: 2 }}>
          <TouchableOpacity onPress={pickPhoto} disabled={photos.length >= 4 || !!video}>
            <MaterialIcons
              name="add-photo-alternate"
              size={22}
              color={photos.length >= 4 || !!video ? theme.textDim : '#e33835'}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={pickVideo} disabled={photos.length > 0 || !!video}>
            <MaterialIcons
              name="videocam"
              size={22}
              color={photos.length > 0 || !!video ? theme.textDim : theme.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Input */}
        <TextInput
          style={{
            flex: 1,
            backgroundColor: theme.surface2,
            borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
            color: theme.text, fontSize: 14, maxHeight: 120,
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

        {/* Wyślij */}
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

      <PhotoViewer
        photos={photos}
        initialIndex={photoIdx}
        visible={photoViewer}
        onClose={() => setPhotoViewer(false)}
      />
    </View>
  );
};
