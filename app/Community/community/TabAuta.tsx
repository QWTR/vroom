import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, FlatList, RefreshControl,
  Modal, Pressable, ActivityIndicator, Dimensions, TextInput, ScrollView,
  Alert, Platform, StyleSheet,
} from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { type VroomkiPost, type VroomkiComment, Avatar, ListFooter } from './communityShared';
import { ShareVroomkiModal } from '../../../components/modals/ShareVroomkiModal';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const FALLBACK_REEL_H = Math.max(560, SCREEN_H - 190);
const VIEW_THRESHOLD_MS = 1600;
const DOUBLE_TAP_MS = 280;

const getToken = () => AsyncStorage.getItem('token');
const showToast = (params: any) => Toast.show(params);

interface GarageCar {
  id: number;
  brand: string;
  specs: string;
  isMain: boolean;
  photos: string[];
}

function ReelVideo({
  uri,
  active,
  onCompleted,
  onDoubleTap,
}: {
  uri: string;
  active: boolean;
  onCompleted: (watchMs: number) => void;
  onDoubleTap: () => void;
}) {
  const videoRef = useRef<Video>(null);
  const completedRef = useRef(false);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    if (!active) {
      setPausedByUser(false);
      videoRef.current?.pauseAsync().catch(() => {});
      return;
    }
    if (!pausedByUser) videoRef.current?.playAsync().catch(() => {});
  }, [active, pausedByUser]);

  const onStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPlaying(!!status.isPlaying);
    if (status.isPlaying || (status.positionMillis ?? 0) > 0) setHasLoadedOnce(true);
    setBuffering(!!status.isBuffering && !status.isPlaying);
    const duration = status.durationMillis ?? 0;
    const position = status.positionMillis ?? 0;
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
        isLooping
        useNativeControls={false}
        progressUpdateIntervalMillis={500}
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

function VroomkiComposer({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (caption: string, photos: string[], video: string | null, carId: number | null) => Promise<void>;
}) {
  const { theme } = useTheme();
  const [garageCars, setGarageCars] = useState<GarageCar[]>([]);
  const [garageLoading, setGarageLoading] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      setGarageLoading(true);
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/api/cars`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setGarageCars(Array.isArray(data) ? data : data.cars ?? []);
      } catch {
        showToast({ type: 'error', text1: 'Błąd ładowania garażu' });
      } finally {
        setGarageLoading(false);
      }
    })();
  }, [visible]);

  const reset = () => {
    setCaption('');
    setPhotos([]);
    setVideo(null);
    setSelectedCarId(null);
  };

  const pickPhotos = async () => {
    if (video) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showToast({ type: 'info', text1: 'Brak dostępu do galerii' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.86,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 6 - photos.length),
    });
    if (!result.canceled) {
      setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 6));
    }
  };

  const pickVideo = async () => {
    if (photos.length > 0 || video) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showToast({ type: 'info', text1: 'Brak dostępu do galerii' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 90,
    });
    if (!result.canceled && result.assets[0]) setVideo(result.assets[0].uri);
  };

  const submit = async () => {
    if (posting) return;
    if (!caption.trim() && photos.length === 0 && !video && !selectedCarId) {
      showToast({ type: 'info', text1: 'Dodaj opis, media albo wybierz auto' });
      return;
    }
    setPosting(true);
    try {
      await onCreate(caption.trim(), photos, video, selectedCarId);
      showToast({ type: 'success', text1: 'VROOMKA opublikowana' });
      reset();
      onClose();
    } catch (e: any) {
      showToast({ type: 'error', text1: e?.message ?? 'Nie udało się opublikować' });
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ maxHeight: '88%', backgroundColor: theme.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 16, paddingBottom: 28 }}>
          <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14, letterSpacing: 2 }}>NOWA VROOMKA</Text>
            <TouchableOpacity onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}>
              <MaterialIcons name="close" size={18} color={theme.text} />
            </TouchableOpacity>
          </View>

          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Co pokazujesz? Setup, brzmienie, spot, mod?"
            placeholderTextColor={theme.textDim}
            multiline
            style={{
              minHeight: 90,
              maxHeight: 150,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface2,
              color: theme.text,
              padding: 12,
              fontFamily: 'Orbitron',
              fontSize: 11,
              textAlignVertical: 'top',
            }}
          />

          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, letterSpacing: 1, marginTop: 14, marginBottom: 8 }}>AUTO Z GARAŻU</Text>
          {garageLoading ? <ActivityIndicator color="#e33835" style={{ marginVertical: 12 }} /> : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {garageCars.map(car => {
                const selected = selectedCarId === car.id;
                return (
                  <TouchableOpacity
                    key={car.id}
                    onPress={() => setSelectedCarId(selected ? null : car.id)}
                    style={{
                      width: 132,
                      borderRadius: 16,
                      borderWidth: 1.5,
                      borderColor: selected ? '#e33835' : theme.border,
                      backgroundColor: selected ? '#e3383518' : theme.surface2,
                      padding: 8,
                    }}
                  >
                    {car.photos[0] ? (
                      <Image source={{ uri: car.photos[0] }} style={{ width: '100%', height: 72, borderRadius: 12 }} resizeMode="cover" />
                    ) : (
                      <View style={{ height: 72, borderRadius: 12, backgroundColor: '#e3383510', justifyContent: 'center', alignItems: 'center' }}>
                        <MaterialIcons name="directions-car" size={30} color="#e33835" />
                      </View>
                    )}
                    <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 10, marginTop: 7 }} numberOfLines={1}>{car.brand}</Text>
                    <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2 }} numberOfLines={1}>{car.specs}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {(photos.length > 0 || video) && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 14 }}>
              {video && (
                <View style={{ width: 92, height: 92, borderRadius: 14, overflow: 'hidden' }}>
                  <Video source={{ uri: video }} style={{ flex: 1 }} resizeMode={ResizeMode.COVER} shouldPlay={false} />
                  <TouchableOpacity onPress={() => setVideo(null)} style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialIcons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
              {photos.map((uri, index) => (
                <View key={`${uri}-${index}`} style={{ width: 92, height: 92, borderRadius: 14, overflow: 'hidden' }}>
                  <Image source={{ uri }} style={{ flex: 1 }} resizeMode="cover" />
                  <TouchableOpacity onPress={() => setPhotos(prev => prev.filter((_, i) => i !== index))} style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialIcons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={pickPhotos} disabled={!!video || photos.length >= 6} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="add-photo-alternate" size={22} color={video || photos.length >= 6 ? theme.textDim : '#e33835'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={pickVideo} disabled={photos.length > 0 || !!video} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="videocam" size={22} color={photos.length > 0 || video ? theme.textDim : '#e33835'} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={submit}
              disabled={posting}
              style={{ borderRadius: 16, backgroundColor: '#e33835', paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              {posting && <ActivityIndicator size={14} color="#fff" />}
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11, fontWeight: '800' }}>PUBLIKUJ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VroomkiCommentsModal({
  post,
  onClose,
  onCommentAdded,
}: {
  post: VroomkiPost | null;
  onClose: () => void;
  onCommentAdded: (id: number) => void;
}) {
  const { theme } = useTheme();
  const [comments, setComments] = useState<VroomkiComment[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; username: string } | null>(null);
  const pendingCommentLikesRef = useRef<Set<number>>(new Set());
  const isLegacyCarOnly = post != null && post.id < 0;
  const useVroomkiCommentsApi = post != null && post.id > 0;
  const commentsUrl = isLegacyCarOnly
    ? `${API_URL}/api/cars/${Math.abs(post!.id)}/comments`
    : useVroomkiCommentsApi
    ? `${API_URL}/api/vroomki/${post!.id}/comments`
    : null;

  useEffect(() => {
    setReplyTo(null);
    setText('');
  }, [post?.id]);

  useEffect(() => {
    if (!post || !commentsUrl) return;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };
        const mapComment = (comment: any, legacy = false): VroomkiComment => ({
          id: comment.id,
          content: comment.content ?? comment.text ?? '',
          createdAt: comment.createdAt,
          author: comment.author ?? comment.user,
          replyTo: legacy ? null : (comment.replyTo ?? null),
          likesCount: legacy ? 0 : (comment.likesCount ?? 0),
          isLiked: legacy ? false : !!comment.isLiked,
          legacyOnly: legacy,
        });

        const res = await fetch(commentsUrl, { headers });
        const data = await res.json();
        let list: VroomkiComment[] = (Array.isArray(data) ? data : []).map((c: any) => mapComment(c));

        if (useVroomkiCommentsApi && post.legacyCarId) {
          const carRes = await fetch(`${API_URL}/api/cars/${post.legacyCarId}/comments`, { headers });
          if (carRes.ok) {
            const carData = await carRes.json();
            const legacyList = (Array.isArray(carData) ? carData : []).map((c: any) => mapComment(c, true));
            const vroomkiIds = new Set(list.map((c) => `${c.author.id}:${c.content}:${c.createdAt}`));
            const merged = [
              ...list,
              ...legacyList.filter((c) => !vroomkiIds.has(`${c.author.id}:${c.content}:${c.createdAt}`)),
            ];
            merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            list = merged;
          }
        }

        setComments(list);
      } catch {
        showToast({ type: 'error', text1: 'Błąd ładowania komentarzy' });
      } finally {
        setLoading(false);
      }
    })();
  }, [commentsUrl, post, useVroomkiCommentsApi]);

  const likeComment = async (commentId: number) => {
    if (!useVroomkiCommentsApi) return;
    if (pendingCommentLikesRef.current.has(commentId)) return;
    const current = comments.find(c => c.id === commentId);
    if (!current) return;
    const nextLiked = !current.isLiked;
    const nextCount = Math.max(0, (current.likesCount ?? 0) + (nextLiked ? 1 : -1));
    pendingCommentLikesRef.current.add(commentId);
    setComments(prev => prev.map(c => c.id === commentId ? { ...c, isLiked: nextLiked, likesCount: nextCount } : c));
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/comments/${commentId}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setComments(prev => prev.map(c => c.id === commentId
        ? { ...c, isLiked: !!data.liked, likesCount: data.likesCount ?? nextCount }
        : c,
      ));
    } catch {
      setComments(prev => prev.map(c => c.id === commentId ? current : c));
    } finally {
      pendingCommentLikesRef.current.delete(commentId);
    }
  };

  const send = async () => {
    if (!post || !commentsUrl || !text.trim() || posting) return;
    setPosting(true);
    try {
      const token = await getToken();
      const body = isLegacyCarOnly
        ? { text: text.trim() }
        : { content: text.trim(), ...(replyTo ? { replyToId: replyTo.id } : {}) };
      const res = await fetch(commentsUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rawComment = await res.json();
      if (!res.ok) throw new Error(rawComment?.error);
      const comment: VroomkiComment = {
        id: rawComment.id,
        content: rawComment.content ?? rawComment.text ?? '',
        createdAt: rawComment.createdAt,
        author: rawComment.author ?? rawComment.user,
        replyTo: rawComment.replyTo ?? null,
        likesCount: rawComment.likesCount ?? 0,
        isLiked: !!rawComment.isLiked,
      };
      setComments(prev => [...prev, comment]);
      setText('');
      setReplyTo(null);
      onCommentAdded(post.id);
    } catch (e: any) {
      showToast({ type: 'error', text1: e?.message ?? 'Nie udało się dodać komentarza' });
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={!!post} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ maxHeight: '78%', backgroundColor: theme.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, paddingBottom: Platform.OS === 'ios' ? 28 : 18 }}>
          <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, letterSpacing: 2, marginBottom: 12 }}>KOMENTARZE</Text>
          {loading ? <ActivityIndicator color="#e33835" style={{ marginVertical: 30 }} /> : (
            <FlatList
              data={comments}
              keyExtractor={item => `${item.legacyOnly ? 'legacy' : 'vroomki'}-${item.id}`}
              style={{ maxHeight: 330 }}
              contentContainerStyle={{ gap: 10, paddingBottom: 10 }}
              ListEmptyComponent={<Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, textAlign: 'center', marginVertical: 28 }}>Bądź pierwszy w komentarzach</Text>}
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Avatar user={item.author} size={34} />
                  <View style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                      {item.author.username}
                    </Text>
                    {item.replyTo && (
                      <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 10, marginTop: 5, opacity: 0.85 }}>
                        ↩ odpowiedź dla @{item.replyTo.username}
                      </Text>
                    )}
                    <Text style={{ color: theme.text, marginTop: 6, fontSize: 14, lineHeight: 20 }}>{item.content}</Text>
                    {useVroomkiCommentsApi && !item.legacyOnly && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
                        <TouchableOpacity
                          onPress={() => setReplyTo({ id: item.id, username: item.author.username })}
                          activeOpacity={0.85}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            backgroundColor: '#e3383520',
                            borderWidth: 1,
                            borderColor: '#e3383540',
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 9,
                          }}
                        >
                          <MaterialIcons name="reply" size={18} color="#e33835" />
                          <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                            ODPOWIEDZ
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => likeComment(item.id)}
                          activeOpacity={0.85}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            backgroundColor: item.isLiked ? '#e3383528' : theme.surface,
                            borderWidth: 1,
                            borderColor: item.isLiked ? '#e3383560' : theme.border,
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 9,
                          }}
                        >
                          <MaterialCommunityIcons
                            name={item.isLiked ? 'heart' : 'heart-outline'}
                            size={20}
                            color={item.isLiked ? '#e33835' : theme.textDim}
                          />
                          <Text style={{ fontFamily: 'Orbitron', color: item.isLiked ? '#e33835' : theme.textDim, fontSize: 11, fontWeight: '700' }}>
                            {item.likesCount ?? 0}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              )}
            />
          )}
          {replyTo && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 10,
              marginBottom: 4,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: '#e3383518',
              borderWidth: 1,
              borderColor: '#e3383540',
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <MaterialIcons name="reply" size={18} color="#e33835" />
                <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                  Odpowiadasz @{replyTo.username}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={20} color={theme.textDim} />
              </TouchableOpacity>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={replyTo ? `Odpowiedz @${replyTo.username}...` : 'Dodaj komentarz...'}
              placeholderTextColor={theme.textDim}
              style={{ flex: 1, minHeight: 42, borderRadius: 16, backgroundColor: theme.surface2, color: theme.text, paddingHorizontal: 12 }}
            />
            <TouchableOpacity onPress={send} disabled={posting || !text.trim()} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center', opacity: posting || !text.trim() ? 0.5 : 1 }}>
              {posting ? <ActivityIndicator size={16} color="#fff" /> : <MaterialIcons name="send" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
          onCompleted={(ms) => onCompletedView(post, ms)}
          onDoubleTap={likeFromDoubleTap}
        />
      ) : coverPhoto ? (
        <FlatList
          data={photos}
          keyExtractor={(uri, index) => `${uri}-${index}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={StyleSheet.absoluteFill}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / SCREEN_W);
            setPhotoIndex(next);
          }}
          renderItem={({ item }) => (
            <Pressable onPress={handlePhotoPress} style={{ width: SCREEN_W, height }}>
              <Image source={{ uri: item }} style={{ width: SCREEN_W, height }} resizeMode="cover" />
            </Pressable>
          )}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#170909' }]}>
          <MaterialIcons name="directions-car" size={86} color="#e3383555" />
        </View>
      )}

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
  onFollowAuthor, onRefresh, onLoadMore, bottomInset, router,
}: {
  posts: VroomkiPost[];
  focusPostId?: number | null;
  myId: number | null;
  loadingC: boolean;
  refreshingC: boolean;
  loadingMoreC: boolean;
  hasMoreC: boolean;
  onLike: (id: number) => void;
  onCreate: (caption: string, photos: string[], video: string | null, carId: number | null) => Promise<void>;
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
}) {
  const { theme } = useTheme();
  const [composerOpen, setComposerOpen] = useState(false);
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
      <TouchableOpacity onPress={() => setComposerOpen(true)} style={{ marginTop: 20, backgroundColor: '#e33835', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 13 }}>
        <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11 }}>DODAJ VROOMKĘ</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        removeClippedSubviews
        maxToRenderPerBatch={2}
        windowSize={3}
        initialNumToRender={1}
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

      <TouchableOpacity
        onPress={() => setComposerOpen(true)}
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

      <VroomkiComposer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreate={onCreate}
      />
      <VroomkiCommentsModal
        post={commentsPost}
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
