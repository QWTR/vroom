import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, Image, ActivityIndicator, RefreshControl,
  KeyboardAvoidingView, Platform, Modal, Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import { Video, ResizeMode }  from 'expo-av';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';
import { formatDistanceToNow } from 'date-fns';
import { pl }                 from 'date-fns/locale';
import { RouteMiniMap }          from '../../../components/profile/RouteMiniMap';
import { RouteLeaderboardModal } from '../../../components/modals/RouteLeaderboardModal';
import { useRouteLeaderboard }   from '../../../hooks/useRouteLeaderboard';

const PAGE_SIZE = 20;

interface Author { id: number; username: string; avatarUrl: string | null; points: number; }
interface Comment { id: number; content: string; photos: string[]; createdAt: string; author: Author; replyTo?: { id: number; username: string } | null; }
interface Post { id: number; content: string; photos: string[]; videos: string[]; createdAt: string; author: Author; likesCount: number; commentsCount: number; repostsCount: number; isLiked: boolean; isReposted: boolean; }
interface PublicRoute { id: number; name: string; description: string | null; distance: number; isPublic: boolean; createdAt: string; author: { id: number; username: string; avatarUrl: string | null }; points: { latitude: number; longitude: number; order: number }[]; likesCount: number; isLiked: boolean; _count?: { likes: number }; runsCount?: number; }
interface CommunityCar { id: number; brand: string; specs: string; isMain: boolean; photos: string[]; createdAt: string; sharedToCommunity: boolean; owner: { id: number; username: string; avatarUrl: string | null }; likesCount: number; commentsCount: number; isLiked: boolean; }
type Tab = 'dyskusje' | 'trasy' | 'auta';

const getToken = () => AsyncStorage.getItem('token');

// ─── Avatar ───────────────────────────────────────────────
const Avatar = ({ user, size = 40 }: { user: Author; size?: number }) => {
  const { theme } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: theme.border }}>
      {user.avatarUrl
        ? <Image source={{ uri: user.avatarUrl }} style={{ width: size, height: size }} resizeMode="cover" />
        : <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: size * 0.32, fontWeight: '700' }}>{user.username.slice(0, 2).toUpperCase()}</Text>
      }
    </View>
  );
};

// ─── Media Grid ───────────────────────────────────────────
const MediaGrid = ({ photos, videos }: { photos: string[]; videos: string[] }) => {
  if (!photos.length && !videos.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
      {videos.map((uri, i) => (
        <Video key={`v${i}`} source={{ uri }} style={{ width: '100%', height: 200, borderRadius: 12 }} resizeMode={ResizeMode.COVER} useNativeControls isLooping={false} />
      ))}
      {photos.map((uri, i) => (
        <Image key={`p${i}`} source={{ uri }} resizeMode="cover" style={[
          { borderRadius: 12, backgroundColor: '#1a1a1a', overflow: 'hidden' },
          photos.length === 1 && { width: '100%', height: 220 },
          photos.length === 2 && { width: '49%', height: 160 },
          photos.length >= 3  && { width: '32%', height: 110 },
        ]} />
      ))}
    </View>
  );
};

// ─── Delete Modal ─────────────────────────────────────────
const DeleteModal = ({ visible, onConfirm, onCancel }: { visible: boolean; onConfirm: () => void; onCancel: () => void }) => {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: theme.border2, alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: '#e3383518', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
            <MaterialIcons name="delete-forever" size={32} color="#e33835" />
          </View>
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 15, letterSpacing: 2, marginBottom: 10 }}>USUŃ POST</Text>
          <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 22 }}>
            Czy na pewno chcesz usunąć ten post?{'\n'}<Text style={{ color: '#e33835' }}>Ta operacja jest nieodwracalna.</Text>
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: theme.border2 }} onPress={onCancel}>
              <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12 }}>Anuluj</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }} onPress={onConfirm}>
              <MaterialIcons name="delete" size={15} color="#fff" />
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 12 }}>USUŃ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ─── PostCard ─────────────────────────────────────────────
const PostCard = React.memo(({ post, myId, onLike, onRepost, onComment, onDelete, onProfile }: {
  post: Post; myId: number | null;
  onLike: (id: number) => void; onRepost: (id: number) => void;
  onComment: (post: Post) => void; onDelete: (id: number) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme } = useTheme();
  const [showDelete, setShowDelete] = useState(false);
  const isOwn = post.author.id === myId;
  const time  = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: pl });
  return (
    <>
      <TouchableOpacity style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 14 }} activeOpacity={0.97} onPress={() => onComment(post)}>
        <View style={{ alignItems: 'center', marginRight: 12, width: 42 }}>
          <TouchableOpacity onPress={() => onProfile(post.author.id)}>
            <Avatar user={post.author} size={42} />
          </TouchableOpacity>
          <View style={{ flex: 1, width: 1.5, backgroundColor: theme.border, marginTop: 6, minHeight: 20 }} />
        </View>
        <View style={{ flex: 1, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
            <TouchableOpacity onPress={() => onProfile(post.author.id)} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{post.author.username}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#e3383512', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                  <MaterialIcons name="bolt" size={10} color="#e33835" />
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>{post.author.points}</Text>
                </View>
              </View>
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, marginLeft: 8 }}>{time}</Text>
            {isOwn && (
              <TouchableOpacity onPress={() => setShowDelete(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ paddingLeft: 8 }}>
                <MaterialIcons name="more-horiz" size={18} color={theme.textDim} />
              </TouchableOpacity>
            )}
          </View>
          {post.content.length > 0 && <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 21, marginBottom: 10 }}>{post.content}</Text>}
          <MediaGrid photos={post.photos ?? []} videos={post.videos ?? []} />
          {post.isReposted && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <MaterialCommunityIcons name="repeat" size={11} color="#4de926" />
              <Text style={{ fontFamily: 'Orbitron', color: '#4de926', fontSize: 9 }}>Zrepostowane przez Ciebie</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 22, marginTop: 2 }}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onComment(post)}>
              <MaterialCommunityIcons name="comment-outline" size={17} color={theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11 }}>{post.commentsCount}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onRepost(post.id)}>
              <MaterialCommunityIcons name="repeat" size={17} color={post.isReposted ? '#4de926' : theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: post.isReposted ? '#4de926' : theme.textDim }}>{post.repostsCount}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onLike(post.id)}>
              <MaterialCommunityIcons name={post.isLiked ? 'heart' : 'heart-outline'} size={17} color={post.isLiked ? '#e33835' : theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: post.isLiked ? '#e33835' : theme.textDim }}>{post.likesCount}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
      <DeleteModal visible={showDelete} onCancel={() => setShowDelete(false)} onConfirm={() => { setShowDelete(false); onDelete(post.id); }} />
    </>
  );
});

// ─── RouteCard ────────────────────────────────────────────
const RouteCard = React.memo(({ route, myId, onLike, onNavigate, onShare, onLeaderboard, onProfile }: {
  route: PublicRoute; myId: number | null;
  onLike: (id: number) => void; onNavigate: (r: PublicRoute) => void;
  onShare: (r: PublicRoute) => void; onLeaderboard: (r: PublicRoute) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme } = useTheme();
  const time = formatDistanceToNow(new Date(route.createdAt), { addSuffix: true, locale: pl });
  return (
    <View style={{ backgroundColor: theme.surface, marginHorizontal: 12, marginTop: 10, borderRadius: 16, borderWidth: 1, borderColor: theme.border2, padding: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <TouchableOpacity onPress={() => onProfile(route.author.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.surface2, overflow: 'hidden', borderWidth: 1, borderColor: theme.border, justifyContent: 'center', alignItems: 'center' }}>
            {route.author.avatarUrl
              ? <Image source={{ uri: route.author.avatarUrl }} style={{ width: 34, height: 34 }} />
              : <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>{route.author.username.slice(0, 2).toUpperCase()}</Text>
            }
          </View>
          <View>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>{route.author.username}</Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>{time}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#00bfff12', borderRadius: 10, borderWidth: 1, borderColor: '#00bfff30', paddingHorizontal: 10, paddingVertical: 7 }} onPress={() => onShare(route)} activeOpacity={0.8}>
          <MaterialIcons name="send" size={13} color="#00bfff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff', fontWeight: '700' }}>WYŚLIJ</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }} onPress={() => onLeaderboard(route)} activeOpacity={0.8}>
        <View style={{ backgroundColor: theme.bg, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
          <RouteMiniMap points={route.points} width={100} height={65} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700', marginBottom: 4 }} numberOfLines={1}>{route.name}</Text>
          {!!route.description && <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginBottom: 6, lineHeight: 13 }} numberOfLines={2}>{route.description}</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <MaterialIcons name="straighten" size={10} color="#e33835" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{route.distance.toFixed(1)} km</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <MaterialIcons name="place" size={10} color={theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{route.points.length} pkt</Text>
            </View>
            {route.runsCount != null && route.runsCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <MaterialIcons name="replay" size={10} color={theme.textDim} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{route.runsCount} przej.</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <MaterialIcons name="leaderboard" size={9} color="#FFD70060" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#FFD70060' }}>DOTKNIJ ABY ZOBACZYĆ RANKING</Text>
          </View>
        </View>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onLike(route.id)}>
          <MaterialCommunityIcons name={route.isLiked ? 'heart' : 'heart-outline'} size={17} color={route.isLiked ? '#e33835' : theme.textDim} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: route.isLiked ? '#e33835' : theme.textDim }}>{route.likesCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFD70012', borderRadius: 10, borderWidth: 1, borderColor: '#FFD70030', paddingHorizontal: 10, paddingVertical: 9 }} onPress={() => onLeaderboard(route)} activeOpacity={0.8}>
          <MaterialIcons name="leaderboard" size={13} color="#FFD700" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#FFD700', fontWeight: '700' }}>TOP</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 9 }} onPress={() => onNavigate(route)} activeOpacity={0.8}>
          <MaterialIcons name="navigation" size={13} color="#fff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>NAWIGUJ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── CarCard ──────────────────────────────────────────────
const CarCard = React.memo(({ car, myId, onLike, onPress, onProfile }: {
  car: CommunityCar; myId: number | null;
  onLike: (id: number) => void; onPress: (c: CommunityCar) => void; onProfile: (id: number) => void;
}) => {
  const { theme } = useTheme();
  const time = formatDistanceToNow(new Date(car.createdAt), { addSuffix: true, locale: pl });
  return (
    <TouchableOpacity style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border2, overflow: 'hidden' }} onPress={() => onPress(car)} activeOpacity={0.92}>
      {car.photos.length > 0
        ? <Image source={{ uri: car.photos[0] }} style={{ width: '100%', height: 130 }} resizeMode="cover" />
        : <View style={{ width: '100%', height: 130, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name="directions-car" size={36} color="#e33835" />
          </View>
      }
      {car.photos.length > 1 && (
        <View style={{ position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#000000aa', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 }}>
          <MaterialIcons name="photo-library" size={10} color="#fff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff' }}>{car.photos.length}</Text>
        </View>
      )}
      <View style={{ padding: 10 }}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }} onPress={() => onProfile(car.owner.id)}>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
            {car.owner.avatarUrl
              ? <Image source={{ uri: car.owner.avatarUrl }} style={{ width: 26, height: 26 }} />
              : <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 8, fontWeight: '700' }}>{car.owner.username.slice(0, 2).toUpperCase()}</Text>
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{car.owner.username}</Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 1 }}>{time}</Text>
          </View>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700', marginBottom: 2 }} numberOfLines={1}>{car.brand}</Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', marginBottom: 8 }} numberOfLines={1}>{car.specs}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onLike(car.id)}>
            <MaterialCommunityIcons name={car.isLiked ? 'heart' : 'heart-outline'} size={17} color={car.isLiked ? '#e33835' : theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: car.isLiked ? '#e33835' : theme.textDim }}>{car.likesCount}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onPress(car)}>
            <MaterialCommunityIcons name="comment-outline" size={17} color={theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim }}>{car.commentsCount}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
            <MaterialIcons name="open-in-new" size={10} color={theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>SZCZEGÓŁY</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── ComposeBox ───────────────────────────────────────────
// ← ZMIANA: przyjmuje insets.bottom z zewnątrz
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

  const pickPhoto = async () => {
    if (photos.length >= 4 || video) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (!r.canceled && r.assets[0]) setPhotos(prev => [...prev, r.assets[0].uri]);
  };
  const pickVideo = async () => {
    if (photos.length > 0 || video) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 60 });
    if (!r.canceled && r.assets[0]) {
      if (((r.assets[0] as any).fileSize ?? 0) > 20 * 1024 * 1024) { Toast.show({ type: 'error', text1: 'Film za duży', text2: 'Maksymalnie 20MB' }); return; }
      setVideo(r.assets[0].uri);
    }
  };
  const canSend = text.trim().length > 0 || photos.length > 0 || !!video;
  const handleSend = async () => {
    if (!canSend) return;
    setPosting(true);
    await onPost(text.trim(), photos, video);
    setText(''); setPhotos([]); setVideo(null); setPosting(false);
  };

  return (
    <View style={{
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      paddingTop: 10,
      // ← KLUCZOWE: uwzględnia Android nav bar
      paddingBottom: Math.max(bottomInset, 10),
    }}>
      {(photos.length > 0 || video) && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {video && (
            <View style={{ position: 'relative' }}>
              <Video source={{ uri: video }} style={{ width: 58, height: 58, borderRadius: 10 }} resizeMode={ResizeMode.COVER} shouldPlay={false} />
              <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: '#000000aa', borderRadius: 5, padding: 2 }}>
                <MaterialIcons name="videocam" size={10} color="#fff" />
              </View>
              <TouchableOpacity style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#e33835', borderRadius: 9, width: 17, height: 17, justifyContent: 'center', alignItems: 'center' }} onPress={() => setVideo(null)}>
                <MaterialIcons name="close" size={11} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
          {photos.map((uri, i) => (
            <View key={i} style={{ position: 'relative' }}>
              <Image source={{ uri }} style={{ width: 58, height: 58, borderRadius: 10, backgroundColor: theme.surface2 }} />
              <TouchableOpacity style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#e33835', borderRadius: 9, width: 17, height: 17, justifyContent: 'center', alignItems: 'center' }} onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}>
                <MaterialIcons name="close" size={11} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <TouchableOpacity onPress={pickPhoto} disabled={photos.length >= 4 || !!video} style={{ paddingBottom: 3 }}>
          <MaterialIcons name="add-photo-alternate" size={22} color={photos.length >= 4 || !!video ? theme.textDim : '#e33835'} />
        </TouchableOpacity>
        <TouchableOpacity onPress={pickVideo} disabled={photos.length > 0 || !!video} style={{ paddingBottom: 3 }}>
          <MaterialIcons name="videocam" size={22} color={photos.length > 0 || !!video ? theme.textDim : theme.textMuted} />
        </TouchableOpacity>
        <TextInput
          style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: theme.text, fontSize: 14, maxHeight: 100, borderWidth: 1, borderColor: theme.border }}
          value={text} onChangeText={setText}
          placeholder="Co słychać w garażu?" placeholderTextColor={theme.textDim} multiline maxLength={500}
        />
        <TouchableOpacity
          style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' }, !canSend && { opacity: 0.3 }]}
          onPress={handleSend} disabled={posting || !canSend}
        >
          {posting ? <ActivityIndicator size={14} color="#fff" /> : <MaterialIcons name="send" size={17} color="#fff" />}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── Footer loader ────────────────────────────────────────
const ListFooter = ({ loading }: { loading: boolean }) => {
  const { theme } = useTheme();
  if (!loading) return null;
  return <ActivityIndicator color={theme.primary ?? '#e33835'} style={{ padding: 20 }} />;
};

// ─── GŁÓWNY EKRAN ─────────────────────────────────────────
export default function CommunityScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();

  // ← KLUCZOWE: insets na poziomie głównego komponentu
  const insets = useSafeAreaInsets();

  const [activeTab,    setActiveTab]    = useState<Tab>('dyskusje');
  const [myId,         setMyId]         = useState<number | null>(null);
  const [search,       setSearch]       = useState('');
  const [searchActive, setSearchActive] = useState(false);

  const [posts,         setPosts]         = useState<Post[]>([]);
  const [loadingP,      setLoadingP]      = useState(true);
  const [refreshingP,   setRefreshingP]   = useState(false);
  const [postCursor,    setPostCursor]    = useState<number | null>(null);
  const [loadingMoreP,  setLoadingMoreP]  = useState(false);
  const [hasMoreP,      setHasMoreP]      = useState(true);

  const [routes,        setRoutes]        = useState<PublicRoute[]>([]);
  const [loadingR,      setLoadingR]      = useState(false);
  const [refreshingR,   setRefreshingR]   = useState(false);
  const [routeCursor,   setRouteCursor]   = useState<number | null>(null);
  const [loadingMoreR,  setLoadingMoreR]  = useState(false);
  const [hasMoreR,      setHasMoreR]      = useState(true);

  const [cars,          setCars]          = useState<CommunityCar[]>([]);
  const [loadingC,      setLoadingC]      = useState(false);
  const [refreshingC,   setRefreshingC]   = useState(false);
  const [carCursor,     setCarCursor]     = useState<number | null>(null);
  const [loadingMoreC,  setLoadingMoreC]  = useState(false);
  const [hasMoreC,      setHasMoreC]      = useState(true);

  const { data: lbData, runsData: lbRunsData, loading: lbLoading, fetchLeaderboard, fetchRuns } = useRouteLeaderboard();
  const [lbRoute, setLbRoute] = useState<PublicRoute | null>(null);

  const [shareRoute,   setShareRoute]   = useState<PublicRoute | null>(null);
  const [shareConvs,   setShareConvs]   = useState<any[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSending, setShareSending] = useState<number | null>(null);
  const [shareSent,    setShareSent]    = useState<number[]>([]);

  const [commentPost,     setCommentPost]     = useState<Post | null>(null);
  const [comments,        setComments]        = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText,     setCommentText]     = useState('');
  const [commentPhotos,   setCommentPhotos]   = useState<string[]>([]);
  const [postingComment,  setPostingComment]  = useState(false);
  const [replyTo,         setReplyTo]         = useState<{ id: number; username: string } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) { const u = JSON.parse(raw); setMyId(u.userId ?? u.id); }
    });
  }, []);

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

  const loadMorePosts = useCallback(() => {
    if (!postCursor || loadingMoreP || !hasMoreP) return;
    setLoadingMoreP(true);
    fetchPosts(postCursor);
  }, [postCursor, loadingMoreP, hasMoreP, fetchPosts]);

  const fetchRoutes = useCallback(async (cursor?: number) => {
    if (!cursor) setLoadingR(true);
    try {
      const token = await getToken();
      const url   = cursor
        ? `${API_URL}/api/routes/community?cursor=${cursor}&limit=${PAGE_SIZE}`
        : `${API_URL}/api/routes/community?limit=${PAGE_SIZE}`;
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      const newRoutes  = Array.isArray(json) ? json : json.routes ?? [];
      const nextCursor = Array.isArray(json) ? null : (json.nextCursor ?? null);
      if (cursor) setRoutes(prev => [...prev, ...newRoutes]);
      else        setRoutes(newRoutes);
      setRouteCursor(nextCursor);
      setHasMoreR(!!nextCursor);
    } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania tras' }); }
    finally { setLoadingR(false); setRefreshingR(false); setLoadingMoreR(false); }
  }, []);

  const loadMoreRoutes = useCallback(() => {
    if (!routeCursor || loadingMoreR || !hasMoreR) return;
    setLoadingMoreR(true);
    fetchRoutes(routeCursor);
  }, [routeCursor, loadingMoreR, hasMoreR, fetchRoutes]);

  const fetchCars = useCallback(async (cursor?: number) => {
    if (!cursor) setLoadingC(true);
    try {
      const token = await getToken();
      const url   = cursor
        ? `${API_URL}/api/cars/community?cursor=${cursor}&limit=${PAGE_SIZE}`
        : `${API_URL}/api/cars/community?limit=${PAGE_SIZE}`;
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      const newCars    = Array.isArray(json) ? json : json.cars ?? [];
      const nextCursor = Array.isArray(json) ? null : (json.nextCursor ?? null);
      if (cursor) setCars(prev => [...prev, ...newCars]);
      else        setCars(newCars);
      setCarCursor(nextCursor);
      setHasMoreC(!!nextCursor);
    } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania aut' }); }
    finally { setLoadingC(false); setRefreshingC(false); setLoadingMoreC(false); }
  }, []);

  const loadMoreCars = useCallback(() => {
    if (!carCursor || loadingMoreC || !hasMoreC) return;
    setLoadingMoreC(true);
    fetchCars(carCursor);
  }, [carCursor, loadingMoreC, hasMoreC, fetchCars]);

  const openLeaderboard = useCallback(async (route: PublicRoute) => {
    setLbRoute(route);
    await Promise.all([fetchLeaderboard(route.id), fetchRuns(route.id)]);
  }, [fetchLeaderboard, fetchRuns]);

  useFocusEffect(useCallback(() => {
    setLoadingP(true);
    setHasMoreP(true);
    setHasMoreR(true);
    setHasMoreC(true);
    fetchPosts();
    fetchRoutes();
    fetchCars();
  }, []));

  const handleNavigateRoute = useCallback(async (route: PublicRoute) => {
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId: route.id, routeName: route.name,
      points: route.points, distance: route.distance,
    }));
    router.push('/(tabs)/map' as any);
  }, [router]);

  const handleLikeCar  = useCallback(async (id: number) => { setCars(prev => prev.map(c => c.id !== id ? c : { ...c, isLiked: !c.isLiked, likesCount: c.isLiked ? c.likesCount - 1 : c.likesCount + 1 })); const token = await getToken(); await fetch(`${API_URL}/api/cars/${id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }, []);
  const handleLikePost = useCallback(async (id: number) => { setPosts(prev => prev.map(p => p.id !== id ? p : { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 })); const token = await getToken(); await fetch(`${API_URL}/api/posts/${id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }, []);
  const handleRepost   = useCallback(async (id: number) => { setPosts(prev => prev.map(p => p.id !== id ? p : { ...p, isReposted: !p.isReposted, repostsCount: p.isReposted ? p.repostsCount - 1 : p.repostsCount + 1 })); const token = await getToken(); await fetch(`${API_URL}/api/posts/${id}/repost`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }, []);
  const handleDeletePost = useCallback(async (id: number) => { setPosts(prev => prev.filter(p => p.id !== id)); const token = await getToken(); await fetch(`${API_URL}/api/posts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); }, []);
  const handleLikeRoute  = useCallback(async (id: number) => { setRoutes(prev => prev.map(r => r.id !== id ? r : { ...r, isLiked: !r.isLiked, likesCount: r.isLiked ? r.likesCount - 1 : r.likesCount + 1 })); const token = await getToken(); await fetch(`${API_URL}/api/routes/${id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }, []);

  const filteredCars   = search.trim() ? cars.filter(c   => c.brand.toLowerCase().includes(search.toLowerCase()) || c.owner.username.toLowerCase().includes(search.toLowerCase())) : cars;
  const filteredPosts  = search.trim() ? posts.filter(p  => p.content.toLowerCase().includes(search.toLowerCase()) || p.author.username.toLowerCase().includes(search.toLowerCase())) : posts;
  const filteredRoutes = search.trim() ? routes.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.author.username.toLowerCase().includes(search.toLowerCase())) : routes;

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
    try { const token = await getToken(); const res = await fetch(`${API_URL}/api/chat/conversations`, { headers: { Authorization: `Bearer ${token}` } }); const json = await res.json(); setShareConvs(Array.isArray(json) ? json : json.conversations ?? []); }
    catch {} finally { setShareLoading(false); }
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
    try { const token = await getToken(); const res = await fetch(`${API_URL}/api/posts/${post.id}/comments`, { headers: { Authorization: `Bearer ${token}` } }); setComments(await res.json()); }
    catch {} finally { setLoadingComments(false); }
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

  // ── Wspólny paddingBottom dla modali ──────────────────
  const modalBottomPadding = Math.max(insets.bottom, 16);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>

      {/* HEADER */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        {searchActive ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, gap: 8, borderWidth: 1, borderColor: theme.border2 }}>
            <MaterialIcons name="search" size={17} color={theme.textDim} />
            <TextInput style={{ flex: 1, color: theme.text, fontSize: 14 }} value={search} onChangeText={setSearch} placeholder="Szukaj..." placeholderTextColor={theme.textDim} autoFocus />
            <TouchableOpacity onPress={() => { setSearch(''); setSearchActive(false); }}>
              <MaterialIcons name="close" size={17} color={theme.textDim} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
              <MaterialIcons name="arrow-back" size={22} color={theme.text} />
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14, letterSpacing: 2 }}>SPOŁECZNOŚĆ</Text>
            <TouchableOpacity onPress={() => setSearchActive(true)} style={{ padding: 4 }}>
              <MaterialIcons name="search" size={22} color={theme.textDim} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ZAKŁADKI */}
      <View style={{ flexDirection: 'row', marginHorizontal: 14, marginTop: 12, marginBottom: 8, backgroundColor: theme.surface2, borderRadius: 14, padding: 3 }}>
        {([
          { key: 'dyskusje', label: 'DYSKUSJE', icon: 'forum' },
          { key: 'trasy',    label: 'TRASY',    icon: 'map' },
          { key: 'auta',     label: 'AUTA',     icon: 'directions-car' },
        ] as { key: Tab; label: string; icon: string }[]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 11 },
              activeTab === tab.key && { backgroundColor: '#e33835' }]}
            onPress={() => setActiveTab(tab.key)} activeOpacity={0.8}
          >
            <MaterialIcons name={tab.icon as any} size={14} color={activeTab === tab.key ? '#fff' : theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', color: activeTab === tab.key ? '#fff' : theme.textDim }}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* DYSKUSJE */}
      {activeTab === 'dyskusje' && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {loadingP ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#e33835" size="large" />
            </View>
          ) : (
            <FlatList
              data={filteredPosts} keyExtractor={p => String(p.id)}
              renderItem={({ item }) => (
                <PostCard post={item} myId={myId} onLike={handleLikePost} onRepost={handleRepost}
                  onComment={openComments} onDelete={handleDeletePost}
                  onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })} />
              )}
              refreshControl={<RefreshControl refreshing={refreshingP} onRefresh={() => { setRefreshingP(true); setHasMoreP(true); fetchPosts(); }} tintColor="#e33835" />}
              onEndReached={loadMorePosts}
              onEndReachedThreshold={0.4}
              ListFooterComponent={<ListFooter loading={loadingMoreP} />}
              ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 80, gap: 12 }}><MaterialCommunityIcons name="car-off" size={52} color={theme.border3} /><Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11, letterSpacing: 2 }}>{search ? 'BRAK WYNIKÓW' : 'BRAK POSTÓW'}</Text></View>}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 70 }} />}
              contentContainerStyle={{ paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
            />
          )}
          {/* ← ZMIANA: przekazujemy insets.bottom */}
          <ComposeBox onPost={handlePost} bottomInset={insets.bottom} />
        </KeyboardAvoidingView>
      )}

      {/* TRASY */}
      {activeTab === 'trasy' && (
        loadingR
          ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#e33835" size="large" /></View>
          : (
            <FlatList
              data={filteredRoutes} keyExtractor={r => String(r.id)}
              renderItem={({ item }) => (
                <RouteCard route={item} myId={myId} onLike={handleLikeRoute}
                  onNavigate={handleNavigateRoute} onShare={openShareRoute}
                  onLeaderboard={openLeaderboard}
                  onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })} />
              )}
              refreshControl={<RefreshControl refreshing={refreshingR} onRefresh={() => { setRefreshingR(true); setHasMoreR(true); fetchRoutes(); }} tintColor="#e33835" />}
              onEndReached={loadMoreRoutes}
              onEndReachedThreshold={0.4}
              ListFooterComponent={<ListFooter loading={loadingMoreR} />}
              ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 80, gap: 12 }}><MaterialCommunityIcons name="map-off" size={52} color={theme.border3} /><Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11, letterSpacing: 2 }}>{search ? 'BRAK WYNIKÓW' : 'BRAK TRAS'}</Text></View>}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border }} />}
              // ← ZMIANA: paddingBottom z insets
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) }}
            />
          )
      )}

      {/* AUTA */}
      {activeTab === 'auta' && (
        loadingC
          ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color="#e33835" size="large" /></View>
          : (
            <FlatList
              data={filteredCars} keyExtractor={c => String(c.id)}
              numColumns={2} columnWrapperStyle={{ gap: 10, paddingHorizontal: 12 }}
              renderItem={({ item }) => (
                <CarCard car={item} myId={myId} onLike={handleLikeCar}
                  onPress={c => router.push({ pathname: '/profile/car-detail', params: { id: String(c.id) } })}
                  onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })} />
              )}
              refreshControl={<RefreshControl refreshing={refreshingC} onRefresh={() => { setRefreshingC(true); setHasMoreC(true); fetchCars(); }} tintColor="#e33835" />}
              onEndReached={loadMoreCars}
              onEndReachedThreshold={0.4}
              ListFooterComponent={<ListFooter loading={loadingMoreC} />}
              ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 80, gap: 12 }}><MaterialCommunityIcons name="car-off" size={52} color={theme.border3} /><Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11, letterSpacing: 2 }}>BRAK AUT</Text><Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 4, textAlign: 'center' }}>UDOSTĘPNIJ AUTO Z PROFILU{'\n'}SZCZEGÓŁY AUTA → SPOŁECZNOŚĆ</Text></View>}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              // ← ZMIANA: paddingBottom z insets
              contentContainerStyle={{ paddingTop: 10, paddingBottom: Math.max(insets.bottom, 20) }}
            />
          )
      )}

      {/* ══ MODAL KOMENTARZY ══════════════════════════════════ */}
      <Modal visible={!!commentPost} animationType="slide" transparent onRequestClose={() => setCommentPost(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000bb' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setCommentPost(null)} />
          {/* ← ZMIANA: KeyboardAvoidingView jako osobny wrapper, paddingBottom z insets */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: theme.border2,
              maxHeight: '88%',
            }}
          >
            <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: modalBottomPadding }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, letterSpacing: 2 }}>KOMENTARZE</Text>
                <TouchableOpacity onPress={() => setCommentPost(null)}>
                  <MaterialIcons name="close" size={20} color={theme.textDim} />
                </TouchableOpacity>
              </View>
              {commentPost && (
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12, backgroundColor: theme.surface2, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border }}>
                  <Avatar user={commentPost.author} size={30} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, marginBottom: 3 }}>{commentPost.author.username}</Text>
                    {commentPost.content.length > 0 && <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>{commentPost.content}</Text>}
                  </View>
                </View>
              )}
              <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 10 }} />
              {loadingComments ? (
                <ActivityIndicator color="#e33835" style={{ margin: 30 }} />
              ) : (
                <FlatList
                  data={comments} keyExtractor={c => String(c.id)}
                  style={{ maxHeight: 320 }}
                  renderItem={({ item }) => (
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                      <Avatar user={item.author} size={32} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }}>{item.author.username}</Text>
                          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9 }}>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: pl })}</Text>
                          <TouchableOpacity onPress={() => setReplyTo({ id: item.id, username: item.author.username })} style={{ marginLeft: 'auto' }}>
                            <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>odpowiedz</Text>
                          </TouchableOpacity>
                        </View>
                        {item.replyTo && <Text style={{ fontFamily: 'Orbitron', color: '#e3383560', fontSize: 9, marginBottom: 4 }}>↩ @{item.replyTo.username}</Text>}
                        <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 19 }}>{item.content}</Text>
                        {item.photos?.length > 0 && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {item.photos.map((uri: string, i: number) => (
                              <Image key={i} source={{ uri }} style={{ width: 80, height: 80, borderRadius: 8 }} resizeMode="cover" />
                            ))}
                          </View>
                        )}
                      </View>
                    </View>
                  )}
                  ListEmptyComponent={<Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, textAlign: 'center', marginTop: 24 }}>BRAK KOMENTARZY</Text>}
                  keyboardShouldPersistTaps="handled"
                />
              )}
              {replyTo && (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface2, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 8 }}>
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 10 }}>↩ @{replyTo.username}</Text>
                  <TouchableOpacity onPress={() => setReplyTo(null)}>
                    <MaterialIcons name="close" size={14} color={theme.textDim} />
                  </TouchableOpacity>
                </View>
              )}
              {commentPhotos.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  {commentPhotos.map((uri, i) => (
                    <View key={i} style={{ position: 'relative' }}>
                      <Image source={{ uri }} style={{ width: 58, height: 58, borderRadius: 10 }} />
                      <TouchableOpacity style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#e33835', borderRadius: 9, width: 17, height: 17, justifyContent: 'center', alignItems: 'center' }} onPress={() => setCommentPhotos(prev => prev.filter((_, idx) => idx !== i))}>
                        <MaterialIcons name="close" size={11} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
                <TouchableOpacity onPress={pickCommentPhoto} disabled={commentPhotos.length >= 2}>
                  <MaterialIcons name="add-photo-alternate" size={22} color={commentPhotos.length >= 2 ? theme.textDim : '#e33835'} />
                </TouchableOpacity>
                <TextInput
                  style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: theme.text, fontSize: 13, maxHeight: 80, borderWidth: 1, borderColor: theme.border }}
                  value={commentText} onChangeText={setCommentText}
                  placeholder={replyTo ? `Odpowiedz @${replyTo.username}...` : 'Napisz komentarz...'}
                  placeholderTextColor={theme.textDim} multiline
                />
                <TouchableOpacity
                  style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' },
                    (!commentText.trim() && commentPhotos.length === 0) && { opacity: 0.3 }]}
                  onPress={handleSendComment}
                  disabled={(!commentText.trim() && commentPhotos.length === 0) || postingComment}
                >
                  {postingComment ? <ActivityIndicator size={14} color="#fff" /> : <MaterialIcons name="send" size={16} color="#fff" />}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ══ MODAL WYŚLIJ TRASĘ ════════════════════════════════ */}
      <Modal visible={!!shareRoute} animationType="slide" transparent onRequestClose={() => setShareRoute(null)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShareRoute(null)} />
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            maxHeight: '80%',
            borderTopWidth: 1, borderColor: theme.border2,
            paddingHorizontal: 16,
            // ← ZMIANA: insets.bottom
            paddingBottom: modalBottomPadding,
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.border }}>
              <MaterialCommunityIcons name="map-marker-path" size={18} color="#e33835" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>WYŚLIJ TRASĘ</Text>
              <TouchableOpacity onPress={() => setShareRoute(null)} style={{ padding: 4 }}>
                <MaterialIcons name="close" size={20} color={theme.textDim} />
              </TouchableOpacity>
            </View>
            {shareRoute && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface2, borderRadius: 12, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: theme.primaryBorder }}>
                <View style={{ backgroundColor: theme.bg, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
                  <RouteMiniMap points={shareRoute.points} width={80} height={50} />
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
                        : <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>{name.slice(0, 2).toUpperCase()}</Text>
                          </View>
                      }
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '600' }} numberOfLines={1}>{name}</Text>
                        {conv.isGroup && <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>{conv.participants?.length} uczestników</Text>}
                      </View>
                      <TouchableOpacity
                        style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
                          isSent ? { backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92630' } : { backgroundColor: '#e33835' }]}
                        onPress={() => !isSent && handleSendRouteToChat(conv.id)}
                        disabled={isSent || shareSending === conv.id} activeOpacity={0.8}
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

      <RouteLeaderboardModal
        visible={lbRoute !== null}
        routeId={lbRoute?.id ?? null}
        routeName={lbRoute?.name ?? ''}
        data={lbData} runsData={lbRunsData} loading={lbLoading}
        onClose={() => setLbRoute(null)}
      />
    </SafeAreaView>
  );
}