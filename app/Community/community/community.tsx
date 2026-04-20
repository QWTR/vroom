import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Linking, TouchableOpacity, TextInput,
  Image, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
  Platform, Modal, Pressable, ScrollView, Dimensions,
  StatusBar, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect }        from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import { Video, ResizeMode }  from 'expo-av';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { BlurView }           from 'expo-blur';
import { LinearGradient }     from 'expo-linear-gradient';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { RouteMiniMap }          from '../../../components/profile/RouteMiniMap';
import { RouteLeaderboardModal } from '../../../components/modals/RouteLeaderboardModal';
import { useRouteLeaderboard }   from '../../../hooks/useRouteLeaderboard';
import { LinkPreviewCard } from '@/components/chat/LinkPreviewCard';
import { AdNativePost }    from '../../../components/ads/AdNativePost';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const PAGE_SIZE = 20;

// ─── Types ────────────────────────────────────────────────
interface Author        { id: number; username: string; avatarUrl: string | null; points: number; }
interface Comment       { id: number; content: string; photos: string[]; createdAt: string; author: Author; replyTo?: { id: number; username: string } | null; }
interface Post          { id: number; content: string; photos: string[]; videos: string[]; createdAt: string; author: Author; likesCount: number; commentsCount: number; repostsCount: number; isLiked: boolean; isReposted: boolean; }
interface PublicRoute   { id: number; name: string; description: string | null; distance: number; isPublic: boolean; createdAt: string; author: { id: number; username: string; avatarUrl: string | null }; points: { latitude: number; longitude: number; order: number }[]; likesCount: number; isLiked: boolean; _count?: { likes: number }; runsCount?: number; }
interface CommunityCar  { id: number; brand: string; specs: string; isMain: boolean; photos: string[]; createdAt: string; sharedToCommunity: boolean; owner: { id: number; username: string; avatarUrl: string | null }; likesCount: number; commentsCount: number; isLiked: boolean; }
type Tab = 'dyskusje' | 'trasy' | 'auta';

const getToken = () => AsyncStorage.getItem('token');

function extractUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

function renderTextWithLinks(content: string, baseStyle: object, linkColor = '#4a9eff') {
  // Regex wyłapuje http(s):// linki
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlRegex);

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
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

// ─────────────────────────────────────────────────────────
// PHOTO VIEWER (fullscreen lightbox)
// ─────────────────────────────────────────────────────────
const PhotoViewer = ({
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
const Avatar = ({ user, size = 40 }: { user: { username: string; avatarUrl: string | null }; size?: number }) => {
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
const MediaGrid = ({ photos, videos }: { photos: string[]; videos: string[] }) => {
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
const DeleteModal = ({
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
// POST CARD — nowy wygląd
// ─────────────────────────────────────────────────────────
const PostCard = React.memo(({
  post, myId, onLike, onRepost, onComment, onDelete, onProfile,
}: {
  post: Post; myId: number | null;
  onLike: (id: number) => void;
  onRepost: (id: number) => void;
  onComment: (post: Post) => void;
  onDelete: (id: number) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme, isDark } = useTheme();
  const [showDelete, setShowDelete] = useState(false);
  const isOwn = post.author.id === myId;
  const time  = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: pl });

  function parseRouteMessage(content: string) {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.type === 'route') return parsed;
    } catch {}
    return null;  
  }


  const routeData = parseRouteMessage(post.content);
  const linkUrl   = !routeData ? extractUrl(post.content) : null;
  return (
    <>
      <View style={{
        marginHorizontal: 12, marginBottom: 12,
        backgroundColor: theme.surface,
        borderRadius: 20,
        borderWidth: 1, borderColor: theme.border2,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 }}>
          <TouchableOpacity onPress={() => onProfile(post.author.id)}>
            <Avatar user={post.author} size={42} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <TouchableOpacity onPress={() => onProfile(post.author.id)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                  {post.author.username}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#e3383515', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <MaterialIcons name="bolt" size={10} color="#e33835" />
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>{post.author.points}</Text>
                </View>
              </View>
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2, letterSpacing: 1 }}>{time}</Text>
          </View>
          {isOwn && (
            <TouchableOpacity
              onPress={() => setShowDelete(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}
            >
              <MaterialIcons name="more-horiz" size={18} color={theme.textDim} />
            </TouchableOpacity>
          )}
        </View>

        {/* Treść */}
        <TouchableOpacity activeOpacity={0.95} onPress={() => onComment(post)}>
          {post.content.length > 0 && (
            // ← zmień zwykły <Text> na <Text> z zagnieżdżonymi fragmentami
            <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, paddingHorizontal: 14, paddingBottom: 12 }}>
              {renderTextWithLinks(
                post.content,
                { color: theme.textMuted, fontSize: 14, lineHeight: 22 },
              )}
            </Text>
          )}
          <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
            {!!linkUrl && <LinkPreviewCard url={linkUrl} isMe={isOwn} theme={theme} />}
            <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: theme.textDim }}>
              {new Date(post.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          {(post.photos?.length > 0 || post.videos?.length > 0) && (
            <View style={{ paddingHorizontal: post.photos.length === 1 ? 0 : 14 }}>
              <MediaGrid photos={post.photos ?? []} videos={post.videos ?? []} />
            </View>
          )}
        </TouchableOpacity>

        {/* Repost badge */}
        {post.isReposted && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginHorizontal: 14, marginBottom: 8 }}>
            <MaterialCommunityIcons name="repeat" size={11} color="#4de926" />
            <Text style={{ fontFamily: 'Orbitron', color: '#4de926', fontSize: 8, letterSpacing: 1 }}>ZREPOSTOWANE PRZEZ CIEBIE</Text>
          </View>
        )}

        {/* Akcje */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 14, paddingBottom: 12, paddingTop: 6,
          gap: 4,
          borderTopWidth: 1, borderTopColor: theme.border,
        }}>
          <ActionBtn icon="comment-outline" count={post.commentsCount} active={false} onPress={() => onComment(post)} />
          <ActionBtn icon="repeat" count={post.repostsCount} active={post.isReposted} activeColor="#4de926" onPress={() => onRepost(post.id)} />
          <ActionBtn icon={post.isLiked ? 'heart' : 'heart-outline'} count={post.likesCount} active={post.isLiked} activeColor="#e33835" onPress={() => onLike(post.id)} />
        </View>
      </View>
      <DeleteModal visible={showDelete} onCancel={() => setShowDelete(false)} onConfirm={() => { setShowDelete(false); onDelete(post.id); }} />
    </>
  );
});

const ActionBtn = ({
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
// ROUTE CARD
// ─────────────────────────────────────────────────────────
const RouteCard = React.memo(({
  route, myId, onLike, onNavigate, onShare, onLeaderboard, onProfile,
}: {
  route: PublicRoute; myId: number | null;
  onLike: (id: number) => void;
  onNavigate: (r: PublicRoute) => void;
  onShare: (r: PublicRoute) => void;
  onLeaderboard: (r: PublicRoute) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme } = useTheme();
  const time = formatDistanceToNow(new Date(route.createdAt), { addSuffix: true, locale: pl });

  return (
    <View style={{
      marginHorizontal: 12, marginBottom: 12,
      backgroundColor: theme.surface,
      borderRadius: 20, borderWidth: 1, borderColor: theme.border2,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 }}>
        <TouchableOpacity onPress={() => onProfile(route.author.id)}>
          <Avatar user={route.author} size={38} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>{route.author.username}</Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>{time}</Text>
        </View>
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: '#00bfff12', borderRadius: 10,
            borderWidth: 1, borderColor: '#00bfff30',
            paddingHorizontal: 10, paddingVertical: 7,
          }}
          onPress={() => onShare(route)}
        >
          <MaterialIcons name="send" size={13} color="#00bfff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff', fontWeight: '700' }}>WYŚLIJ</Text>
        </TouchableOpacity>
      </View>

      {/* Mapa + info */}
      <TouchableOpacity
        style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingBottom: 12 }}
        onPress={() => onLeaderboard(route)}
        activeOpacity={0.88}
      >
        <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
          <RouteMiniMap points={route.points} width={100} height={70} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700', marginBottom: 4 }} numberOfLines={1}>
            {route.name}
          </Text>
          {!!route.description && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginBottom: 6, lineHeight: 13 }} numberOfLines={2}>
              {route.description}
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <StatPill icon="straighten" value={`${route.distance.toFixed(1)} km`} color="#e33835" />
            <StatPill icon="place" value={`${route.points.length} pkt`} />
            {!!route.runsCount && route.runsCount > 0 && (
              <StatPill icon="replay" value={`${route.runsCount} przej.`} />
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <MaterialIcons name="leaderboard" size={9} color="#FFD70060" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#FFD70060' }}>DOTKNIJ → RANKING</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Footer */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 14, paddingBottom: 12, paddingTop: 8,
        borderTopWidth: 1, borderTopColor: theme.border,
      }}>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          onPress={() => onLike(route.id)}
        >
          <MaterialCommunityIcons
            name={route.isLiked ? 'heart' : 'heart-outline'}
            size={18} color={route.isLiked ? '#e33835' : theme.textDim}
          />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: route.isLiked ? '#e33835' : theme.textDim }}>
            {route.likesCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: '#FFD70015', borderRadius: 10,
            borderWidth: 1, borderColor: '#FFD70030',
            paddingHorizontal: 12, paddingVertical: 8,
          }}
          onPress={() => onLeaderboard(route)}
        >
          <MaterialIcons name="leaderboard" size={13} color="#FFD700" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#FFD700', fontWeight: '700' }}>TOP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center',
            justifyContent: 'center', gap: 6,
            backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 9,
          }}
          onPress={() => onNavigate(route)}
        >
          <MaterialIcons name="navigation" size={14} color="#fff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>NAWIGUJ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const StatPill = ({ icon, value, color }: { icon: string; value: string; color?: string }) => {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <MaterialIcons name={icon as any} size={10} color={color ?? theme.textDim} />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{value}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────
// CAR CARD — nowy wygląd (2 kolumny)
// ─────────────────────────────────────────────────────────
const CarCard = React.memo(({
  car, myId, onLike, onPress, onProfile,
}: {
  car: CommunityCar; myId: number | null;
  onLike: (id: number) => void;
  onPress: (c: CommunityCar) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme } = useTheme();
  const [photoViewer, setPhotoViewer] = useState(false);
  const [photoIdx,    setPhotoIdx]    = useState(0);
  const time = formatDistanceToNow(new Date(car.createdAt), { addSuffix: true, locale: pl });
  return (
    <>
      <TouchableOpacity
        style={{
          flex: 1,
          backgroundColor: theme.surface,
          borderRadius: 18, borderWidth: 1, borderColor: theme.border2,
          overflow: 'hidden',
        }}
        onPress={() => onPress(car)}
        activeOpacity={0.92}
      >
        {/* Zdjęcie */}
        {car.photos.length > 0 ? (
          <TouchableOpacity
            onPress={e => { e.stopPropagation(); setPhotoIdx(0); setPhotoViewer(true); }}
            activeOpacity={0.9}
          >
            <Image
              source={{ uri: car.photos[0] }}
              style={{ width: '100%', height: 130 }}
              resizeMode="cover"
            />
            {car.photos.length > 1 && (
              <View style={{
                position: 'absolute', bottom: 8, right: 8,
                flexDirection: 'row', alignItems: 'center', gap: 3,
                backgroundColor: '#000000bb', borderRadius: 8,
                paddingHorizontal: 7, paddingVertical: 4,
              }}>
                <MaterialIcons name="photo-library" size={10} color="#fff" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff' }}>{car.photos.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{
            width: '100%', height: 130,
            backgroundColor: '#e3383510',
            justifyContent: 'center', alignItems: 'center',
          }}>
            <MaterialIcons name="directions-car" size={40} color="#e33835" />
          </View>
        )}

        <View style={{ padding: 10 }}>
          {/* Autor */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}
            onPress={() => onProfile(car.owner.id)}
          >
            <View style={{
              width: 24, height: 24, borderRadius: 12,
              backgroundColor: '#e3383518', overflow: 'hidden',
              borderWidth: 1, borderColor: '#e3383530',
              justifyContent: 'center', alignItems: 'center',
            }}>
              {car.owner.avatarUrl
                ? <Image source={{ uri: car.owner.avatarUrl }} style={{ width: 24, height: 24 }} />
                : <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 7, fontWeight: '700' }}>
                    {car.owner.username.slice(0, 2).toUpperCase()}
                  </Text>
              }
            </View>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }} numberOfLines={1}>{car.owner.username}</Text>
          </TouchableOpacity>

          <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700', marginBottom: 2 }} numberOfLines={1}>{car.brand}</Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', marginBottom: 8 }} numberOfLines={1}>{car.specs}</Text>

          {/* Footer */}
          <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8, gap: 10 }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              onPress={() => onLike(car.id)}
            >
              <MaterialCommunityIcons
                name={car.isLiked ? 'heart' : 'heart-outline'}
                size={15}
                color={car.isLiked ? '#e33835' : theme.textDim}
              />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: car.isLiked ? '#e33835' : theme.textDim }}>
                {car.likesCount}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              onPress={() => onPress(car)}
            >
              <MaterialCommunityIcons name="comment-outline" size={15} color={theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim }}>{car.commentsCount}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <MaterialIcons name="open-in-new" size={13} color={theme.textDim} />
            </View>
          </View>
        </View>
      </TouchableOpacity>

      <PhotoViewer
        photos={car.photos}
        initialIndex={photoIdx}
        visible={photoViewer}
        onClose={() => setPhotoViewer(false)}
      />
    </>
  );
});

// ─────────────────────────────────────────────────────────
// COMPOSE BOX
// ─────────────────────────────────────────────────────────
const ComposeBox = ({
  onPost,
  bottomInset,
}: {
  onPost: (text: string, photos: string[], video: string | null) => Promise<void>;
  bottomInset: number;
}) => {
  const { theme } = useTheme();
  const [text,    setText]    = useState('');
  const [photos,  setPhotos]  = useState<string[]>([]);
  const [video,   setVideo]   = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [photoViewer, setPhotoViewer] = useState(false);
  const [photoIdx,    setPhotoIdx]    = useState(0);

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
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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

// ─────────────────────────────────────────────────────────
// FOOTER LOADER
// ─────────────────────────────────────────────────────────
const ListFooter = ({ loading }: { loading: boolean }) => {
  if (!loading) return null;
  return <ActivityIndicator color="#e33835" style={{ padding: 20 }} />;
};

// ─────────────────────────────────────────────────────────
// COMMUNITY SCREEN
// ─────────────────────────────────────────────────────────
export default function CommunityScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [activeTab,    setActiveTab]    = useState<Tab>('dyskusje');
  const [myId,         setMyId]         = useState<number | null>(null);
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

  const handlePost = async (text: string, photos: string[], video: string | null) => {
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('content', text);
      photos.forEach((uri, i) => { const ext = uri.split('.').pop() ?? 'jpg'; form.append('photos', { uri, name: `p${i}.${ext}`, type: `image/${ext}` } as any); });
      if (video) { const ext = video.split('.').pop() ?? 'mp4'; form.append('video', { uri: video, name: `video.${ext}`, type: `video/${ext}` } as any); }
      const res  = await fetch(`${API_URL}/api/posts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) throw new Error();
      const post = await res.json();
      setPosts(prev => [post, ...prev]);
    } catch { Toast.show({ type: 'error', text1: 'Błąd wysyłania' }); }
  };

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
      if (existing) { openComments(existing); return; }
      try {
        const token = await getToken();
        const res   = await fetch(`${API_URL}/api/posts/${postId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) openComments(await res.json());
      } catch {}
    })();
  }, [posts, openComments]));

  // ── Filtered lists ───────────────────────────────────────
  const filteredPosts  = search.trim() ? posts.filter(p  => p.content.toLowerCase().includes(search.toLowerCase())  || p.author.username.toLowerCase().includes(search.toLowerCase())) : posts;
  const filteredRoutes = search.trim() ? routes.filter(r => r.name.toLowerCase().includes(search.toLowerCase())     || r.author.username.toLowerCase().includes(search.toLowerCase())) : routes;
  const filteredCars   = search.trim() ? cars.filter(c   => c.brand.toLowerCase().includes(search.toLowerCase())    || c.owner.username.toLowerCase().includes(search.toLowerCase())) : cars;

  type FeedItem = Post | { _adType: 'native'; _adKey: string };

  const feedItems: FeedItem[] = React.useMemo(() => {
    const result: FeedItem[] = [];
    filteredPosts.forEach((post, index) => {
      result.push(post);
      if ((index + 1) % 5 === 0) {
        result.push({ _adType: 'native', _adKey: `ad_${index}` });
      }
    });
    return result;
  }, [filteredPosts]);

  const modalBottomPadding = Math.max(insets.bottom, 16);

  // ── Empty state helper ───────────────────────────────────
  const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) => (
    <View style={{ alignItems: 'center', marginTop: 80, gap: 12 }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#e3383510', justifyContent: 'center', alignItems: 'center' }}>
        <MaterialCommunityIcons name={icon as any} size={40} color="#e3383540" />
      </View>
      <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11, letterSpacing: 2 }}>{title}</Text>
      {subtitle && <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, textAlign: 'center', opacity: 0.7 }}>{subtitle}</Text>}
    </View>
  );

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
            <TouchableOpacity onPress={() => setSearchActive(true)} style={{ padding: 4 }}>
              <MaterialIcons name="search" size={22} color={theme.textDim} />
            </TouchableOpacity>
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {loadingP ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#e33835" size="large" />
            </View>
          ) : (
            <FlatList
              data={feedItems}
              keyExtractor={item => ('_adType' in item) ? item._adKey : String(item.id)}
              renderItem={({ item }) => '_adType' in item ? (
                <AdNativePost />
              ) : (
                <PostCard
                  post={item} myId={myId}
                  onLike={handleLikePost} onRepost={handleRepost}
                  onComment={openComments} onDelete={handleDeletePost}
                  onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
                />
              )}
              refreshControl={<RefreshControl refreshing={refreshingP} onRefresh={() => { setRefreshingP(true); setHasMoreP(true); fetchPosts(); }} tintColor="#e33835" />}
              onEndReached={loadMorePosts}
              onEndReachedThreshold={0.4}
              ListFooterComponent={<ListFooter loading={loadingMoreP} />}
              ListEmptyComponent={<EmptyState icon="car-off" title={search ? 'BRAK WYNIKÓW' : 'BRAK POSTÓW'} />}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
            />
          )}
          <ComposeBox onPost={handlePost} bottomInset={insets.bottom} />
        </KeyboardAvoidingView>
      )}

      {/* ══ TRASY ═════════════════════════════════════════════ */}
      {activeTab === 'trasy' && (
        loadingR
          ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#e33835" size="large" /></View>
          : (
            <FlatList
              data={filteredRoutes}
              keyExtractor={r => String(r.id)}
              renderItem={({ item }) => (
                <RouteCard
                  route={item} myId={myId}
                  onLike={handleLikeRoute} onNavigate={handleNavigateRoute}
                  onShare={openShareRoute} onLeaderboard={openLeaderboard}
                  onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
                />
              )}
              refreshControl={<RefreshControl refreshing={refreshingR} onRefresh={() => { setRefreshingR(true); setHasMoreR(true); fetchRoutes(); }} tintColor="#e33835" />}
              onEndReached={loadMoreRoutes}
              onEndReachedThreshold={0.4}
              ListFooterComponent={<ListFooter loading={loadingMoreR} />}
              ListEmptyComponent={<EmptyState icon="map-off" title={search ? 'BRAK WYNIKÓW' : 'BRAK TRAS'} />}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) }}
            />
          )
      )}

      {/* ══ AUTA ══════════════════════════════════════════════ */}
      {activeTab === 'auta' && (
        loadingC
          ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#e33835" size="large" /></View>
          : (
            <FlatList
              data={filteredCars}
              keyExtractor={c => String(c.id)}
              numColumns={2}
              columnWrapperStyle={{ gap: 10, paddingHorizontal: 12 }}
              renderItem={({ item }) => (
                <CarCard
                  car={item} myId={myId}
                  onLike={handleLikeCar}
                  onPress={c => router.push({ pathname: '/profile/car-detail', params: { id: String(c.id) } })}
                  onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
                />
              )}
              refreshControl={<RefreshControl refreshing={refreshingC} onRefresh={() => { setRefreshingC(true); setHasMoreC(true); fetchCars(); }} tintColor="#e33835" />}
              onEndReached={loadMoreCars}
              onEndReachedThreshold={0.4}
              ListFooterComponent={<ListFooter loading={loadingMoreC} />}
              ListEmptyComponent={<EmptyState icon="car-off" title="BRAK AUT" subtitle={`UDOSTĘPNIJ AUTO Z PROFILU\nSZCZEGÓŁY AUTA → SPOŁECZNOŚĆ`} />}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              contentContainerStyle={{ paddingTop: 10, paddingBottom: Math.max(insets.bottom, 20) }}
            />
          )
      )}

      {/* ══ MODAL KOMENTARZY ══════════════════════════════════ */}
      <Modal
        visible={!!commentPost}
        animationType="slide"
        transparent
        onRequestClose={() => setCommentPost(null)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000bb' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setCommentPost(null)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 28, borderTopRightRadius: 28,
              borderWidth: 1, borderColor: theme.border2,
              maxHeight: '88%',
            }}
          >
            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: modalBottomPadding }}>
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
                      <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>{commentPost.content}</Text>
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
                  data={comments}
                  keyExtractor={c => String(c.id)}
                  style={{ maxHeight: 300 }}
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
                          <TouchableOpacity
                            onPress={() => setReplyTo({ id: item.id, username: item.author.username })}
                            style={{ marginLeft: 'auto' }}
                          >
                            <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 8 }}>↩ odpowiedz</Text>
                          </TouchableOpacity>
                        </View>
                        {item.replyTo && (
                          <Text style={{ fontFamily: 'Orbitron', color: '#e3383555', fontSize: 8, marginBottom: 4 }}>
                            ↩ @{item.replyTo.username}
                          </Text>
                        )}
                        <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 19 }}>{item.content}</Text>
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

              {/* Reply badge */}
              {replyTo && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: '#e3383515', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 7,
                  marginTop: 8, borderWidth: 1, borderColor: '#e3383530',
                }}>
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>↩ @{replyTo.username}</Text>
                  <TouchableOpacity onPress={() => setReplyTo(null)}>
                    <MaterialIcons name="close" size={14} color={theme.textDim} />
                  </TouchableOpacity>
                </View>
              )}

              {/* Podgląd zdjęć komentarza */}
              {commentPhotos.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
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

              {/* Input komentarza */}
              <View style={{
                flexDirection: 'row', alignItems: 'flex-end', gap: 10,
                paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border,
                marginTop: 10,
              }}>
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
                  onChangeText={setCommentText}
                  placeholder={replyTo ? `Odpowiedz @${replyTo.username}...` : 'Napisz komentarz...'}
                  placeholderTextColor={theme.textDim}
                  multiline
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
          </KeyboardAvoidingView>
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