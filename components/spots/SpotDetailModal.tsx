import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Image, FlatList, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Spot, SpotDetails, SpotComment, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';
import { PhotoGalleryModal } from './PhotoGalleryModal';

const API_URL = 'https://v-room.app/api/spots';

interface SpotDetailModalProps {
  visible:       boolean;
  spot:          Spot | null;
  onClose:       () => void;
  getDistance:   (spot: Spot) => number;
  onLikeToggle:  (spotId: string, liked: boolean, count: number) => void;
}

export const SpotDetailModal = ({
  visible, spot, onClose, getDistance, onLikeToggle,
}: SpotDetailModalProps) => {
  const router = useRouter();

  const [details,        setDetails]        = useState<SpotDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [likeLoading,    setLikeLoading]    = useState(false);
  const [commentText,    setCommentText]    = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex,   setGalleryIndex]   = useState(0);
  const [myUserId,       setMyUserId]       = useState<number | null>(null);

  // Pobierz własne ID
  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) {
        const u = JSON.parse(raw);
        setMyUserId(u.userId ?? u.id);
      }
    });
  }, []);

  // Pobierz szczegóły gdy modal się otwiera
  useEffect(() => {
    if (!visible || !spot) return;
    const fetchDetails = async () => {
      setLoadingDetails(true);
      try {
        const token = await AsyncStorage.getItem('userToken');
        const res   = await fetch(`${API_URL}/${spot.id}/details`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setDetails({
          ...spot,
          likesCount:    data.likesCount,
          commentsCount: data.commentsCount,
          isLiked:       data.isLiked,
          comments:      data.comments || [],
          // ← autor jako obiekt z backendu
          authorObj:     data.author ?? null,
        });
      } catch {
        setDetails({ ...spot, comments: [], authorObj: null });
      } finally {
        setLoadingDetails(false);
      }
    };
    fetchDetails();
  }, [visible, spot?.id]);

  // Reset po zamknięciu
  useEffect(() => {
    if (!visible) {
      setDetails(null);
      setCommentText('');
    }
  }, [visible]);

  // ── Like ────────────────────────────────────────────────────────────────
  const handleLike = useCallback(async () => {
    if (!details || likeLoading) return;
    setLikeLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      const res   = await fetch(`${API_URL}/${details.id}/like`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDetails(prev => prev ? { ...prev, isLiked: data.liked, likesCount: data.likesCount } : prev);
      onLikeToggle(details.id, data.liked, data.likesCount);
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie można dodać lajka' });
    } finally {
      setLikeLoading(false);
    }
  }, [details, likeLoading, onLikeToggle]);

  // ── Komentarz ───────────────────────────────────────────────────────────
  const handleComment = useCallback(async () => {
    if (!commentText.trim() || !details || commentLoading) return;
    setCommentLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      const res   = await fetch(`${API_URL}/${details.id}/comments`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: commentText.trim() }),
      });
      if (!res.ok) throw new Error();
      const comment: SpotComment = await res.json();
      setDetails(prev => prev
        ? { ...prev, comments: [comment, ...prev.comments], commentsCount: prev.commentsCount + 1 }
        : prev
      );
      setCommentText('');
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie można dodać komentarza' });
    } finally {
      setCommentLoading(false);
    }
  }, [commentText, details, commentLoading]);

  // ── Nawiguj ─────────────────────────────────────────────────────────────
  const handleNavigate = async () => {
    if (!spot) return;
    await AsyncStorage.setItem('nav_destination', JSON.stringify({
      latitude: spot.latitude, longitude: spot.longitude, name: spot.name,
    }));
    onClose();
    router.push('/(tabs)/map');
    Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: spot.name });
  };

  // ── Zobacz profil autora ────────────────────────────────────────────────
  const handleViewProfile = () => {
    const authorId = details?.authorObj?.id;
    if (!authorId) return;
    onClose();
    router.push({ pathname: '/profile/[userId]', params: { userId: String(authorId) } });
  };

  if (!spot) return null;

  const color      = CATEGORY_COLORS[spot.category];
  const isLiked    = details?.isLiked    ?? spot.isLiked;
  const likesCount = details?.likesCount ?? spot.likesCount;
  const authorObj  = details?.authorObj;
  const authorName = authorObj?.username ?? spot.author;
  const isOwn      = myUserId != null && authorObj?.id === myUserId;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.overlay}
        >
          <View style={s.container}>

            {/* ── Header ── */}
            <View style={s.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <View style={[s.icon, { backgroundColor: color + '22' }]}>
                  <MaterialIcons name={CATEGORY_ICONS[spot.category] as any} size={20} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={1}>{spot.name}</Text>
                  <Text style={[s.categoryText, { color }]}>{spot.category}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={24} color="#ffffff80" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ── Zdjęcia ── */}
              {spot.photos.length > 0 && (
                <>
                  <FlatList
                    data={spot.photos.slice(0, 4)}
                    keyExtractor={(item, i) => `${item}_${i}`}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 4 }}
                    renderItem={({ item, index }) => (
                      <TouchableOpacity
                        onPress={() => { setGalleryIndex(index); setGalleryVisible(true); }}
                        activeOpacity={0.9}
                      >
                        <Image source={{ uri: item }} style={s.photo} />
                        {spot.photos.length > 4 && index === 3 && (
                          <View style={s.photoOverlay}>
                            <Text style={s.photoOverlayText}>+{spot.photos.length - 4}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    )}
                  />
                  <TouchableOpacity
                    style={s.galleryBtn}
                    onPress={() => { setGalleryIndex(0); setGalleryVisible(true); }}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="photo-library" size={14} color="#ffffff40" />
                    <Text style={s.galleryBtnText}>
                      {spot.photos.length} {spot.photos.length === 1 ? 'zdjęcie' : 'zdjęcia'} · dotknij aby powiększyć
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {/* ── Opis ── */}
              <Text style={spot.description ? s.desc : s.noDesc}>
                {spot.description || 'Brak opisu'}
              </Text>

              {/* ── KARTA AUTORA ── */}
              <TouchableOpacity
                style={s.authorCard}
                onPress={handleViewProfile}
                activeOpacity={authorObj?.id ? 0.75 : 1}
                disabled={!authorObj?.id}
              >
                {/* Avatar */}
                <View style={s.authorAvatar}>
                  {authorObj?.avatarUrl ? (
                    <Image source={{ uri: authorObj.avatarUrl }} style={s.authorAvatarImg} />
                  ) : (
                    <Text style={s.authorAvatarText}>
                      {authorName.charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>

                {/* Info */}
                <View style={{ flex: 1 }}>
                  <Text style={s.authorLabel}>TWÓRCA SPOTU</Text>
                  <Text style={s.authorName}>{authorName}</Text>
                </View>

                {/* Metadane */}
                <View style={s.authorMeta}>
                  <Text style={s.authorDate}>
                    {new Date(spot.createdAt).toLocaleDateString('pl-PL')}
                  </Text>
                </View>

                {/* Strzałka tylko jeśli nie własny */}
                {!isOwn && authorObj?.id && (
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#ffffff20" style={{ marginLeft: 6 }} />
                )}
              </TouchableOpacity>

              {/* "Zobacz profil" – osobny przycisk jeśli nie własny profil */}
              {!isOwn && authorObj?.id && (
                <TouchableOpacity style={s.viewProfileBtn} onPress={handleViewProfile} activeOpacity={0.8}>
                  <MaterialIcons name="person" size={16} color="#e33835" />
                  <Text style={s.viewProfileBtnText}>Zobacz profil {authorName}</Text>
                  <MaterialIcons name="arrow-forward" size={14} color="#e33835" />
                </TouchableOpacity>
              )}

              {/* ── Akcje: lajk + komentarze + nawiguj ── */}
              <View style={s.actionsRow}>
                <TouchableOpacity
                  style={[s.likeBtn, isLiked && s.likeBtnActive]}
                  onPress={handleLike}
                  disabled={likeLoading}
                  activeOpacity={0.8}
                >
                  {likeLoading
                    ? <ActivityIndicator size={16} color={isLiked ? '#e33835' : '#ffffff60'} />
                    : <MaterialIcons
                        name={isLiked ? 'favorite' : 'favorite-border'}
                        size={20}
                        color={isLiked ? '#e33835' : '#ffffff60'}
                      />
                  }
                  <Text style={[s.likeBtnText, isLiked && { color: '#e33835' }]}>{likesCount}</Text>
                </TouchableOpacity>

                <View style={s.commentsCountBtn}>
                  <MaterialIcons name="chat-bubble-outline" size={18} color="#ffffff40" />
                  <Text style={s.commentsCountText}>{details?.commentsCount ?? spot.commentsCount}</Text>
                </View>

                <TouchableOpacity style={s.navBtn} onPress={handleNavigate} activeOpacity={0.85}>
                  <MaterialIcons name="navigation" size={18} color="#fff" />
                  <Text style={s.navBtnText}>NAWIGUJ</Text>
                </TouchableOpacity>
              </View>

              {/* ── Komentarze ── */}
              <Text style={s.sectionTitle}>KOMENTARZE</Text>

              <View style={s.commentInputRow}>
                <TextInput
                  style={s.commentInput}
                  placeholder="Dodaj komentarz..."
                  placeholderTextColor="#ffffff30"
                  value={commentText}
                  onChangeText={setCommentText}
                  multiline
                  maxLength={300}
                />
                <TouchableOpacity
                  style={[s.commentSendBtn, !commentText.trim() && { opacity: 0.4 }]}
                  onPress={handleComment}
                  disabled={!commentText.trim() || commentLoading}
                  activeOpacity={0.8}
                >
                  {commentLoading
                    ? <ActivityIndicator size={16} color="#fff" />
                    : <MaterialIcons name="send" size={18} color="#fff" />
                  }
                </TouchableOpacity>
              </View>

              {loadingDetails ? (
                <View style={s.commentsLoader}>
                  <ActivityIndicator color="#e33835" />
                </View>
              ) : details?.comments.length === 0 ? (
                <View style={s.commentsEmpty}>
                  <MaterialIcons name="chat-bubble-outline" size={32} color="#ffffff15" />
                  <Text style={s.commentsEmptyText}>Bądź pierwszy!</Text>
                </View>
              ) : (
                details?.comments.map(c => (
                  <View key={c.id} style={s.commentItem}>
                    <View style={s.commentAvatar}>
                      <Text style={s.commentAvatarText}>
                        {c.user.username.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={s.commentHeader}>
                        <Text style={s.commentUsername}>{c.user.username}</Text>
                        <Text style={s.commentDate}>
                          {new Date(c.createdAt).toLocaleDateString('pl-PL')}
                        </Text>
                      </View>
                      <Text style={s.commentText}>{c.text}</Text>
                    </View>
                  </View>
                ))
              )}

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PhotoGalleryModal
        visible={galleryVisible}
        photos={spot.photos}
        initialIndex={galleryIndex}
        spotName={spot.name}
        onClose={() => setGalleryVisible(false)}
      />
    </>
  );
};

const s = StyleSheet.create({
  overlay:           { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  container:         { backgroundColor: '#161616', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '88%' },
  header:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  icon:              { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  title:             { color: '#fff', fontSize: 15, fontWeight: '700' },
  categoryText:      { fontSize: 11, fontWeight: '600', marginTop: 2 },
  photo:             { width: 160, height: 110, borderRadius: 12, marginRight: 8 },
  photoOverlay:      { position: 'absolute', top: 0, left: 0, width: 160, height: 110, borderRadius: 12, backgroundColor: '#000000bb', justifyContent: 'center', alignItems: 'center' },
  photoOverlayText:  { color: '#fff', fontSize: 22, fontWeight: '700' },
  galleryBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12, marginTop: 4 },
  galleryBtnText:    { color: '#ffffff30', fontSize: 11 },
  desc:              { color: '#ffffffcc', fontSize: 13, lineHeight: 20, marginBottom: 12 },
  noDesc:            { color: '#ffffff30', fontSize: 13, marginBottom: 12 },

  // ── Karta autora ─────────────────────────────────────────────────────────
  authorCard:        {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1e1e1e', borderRadius: 14, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: '#ffffff0a',
  },
  authorAvatar:      {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#e3383540', overflow: 'hidden',
  },
  authorAvatarImg:   { width: 40, height: 40 },
  authorAvatarText:  { color: '#e33835', fontSize: 16, fontWeight: '700' },
  authorLabel:       { color: '#ffffff30', fontSize: 8, letterSpacing: 1, marginBottom: 2 },
  authorName:        { color: '#fff', fontSize: 13, fontWeight: '700' },
  authorMeta:        { alignItems: 'flex-end', gap: 2 },
  authorDate:        { color: '#ffffff40', fontSize: 10 },
  authorDist:        { color: '#ffffff30', fontSize: 10 },

  // ── Przycisk "Zobacz profil" ─────────────────────────────────────────────
  viewProfileBtn:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#e3383512', borderRadius: 12, paddingVertical: 10,
    marginBottom: 16, borderWidth: 1, borderColor: '#e3383530',
  },
  viewProfileBtnText:{ color: '#e33835', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  // ── Akcje ────────────────────────────────────────────────────────────────
  actionsRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  likeBtn:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff10' },
  likeBtnActive:     { borderColor: '#e3383540', backgroundColor: '#e3383515' },
  likeBtnText:       { color: '#ffffff60', fontSize: 13, fontWeight: '600' },
  commentsCountBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff10' },
  commentsCountText: { color: '#ffffff40', fontSize: 13 },
  navBtn:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e33835', borderRadius: 12, height: 44 },
  navBtnText:        { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },

  // ── Komentarze ───────────────────────────────────────────────────────────
  sectionTitle:      { color: '#ffffff40', fontSize: 9, letterSpacing: 1, marginBottom: 12 },
  commentInputRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 16 },
  commentInput:      { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#ffffff10', maxHeight: 80 },
  commentSendBtn:    { width: 44, height: 44, borderRadius: 12, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' },
  commentsLoader:    { paddingVertical: 24, alignItems: 'center' },
  commentsEmpty:     { paddingVertical: 24, alignItems: 'center', gap: 8 },
  commentsEmptyText: { color: '#ffffff20', fontSize: 12 },
  commentItem:       { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commentAvatar:     { width: 34, height: 34, borderRadius: 17, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e3383540' },
  commentAvatarText: { color: '#e33835', fontSize: 14, fontWeight: '700' },
  commentHeader:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  commentUsername:   { color: '#fff', fontSize: 12, fontWeight: '700' },
  commentDate:       { color: '#ffffff30', fontSize: 10 },
  commentText:       { color: '#ffffffaa', fontSize: 13, lineHeight: 18 },
});