import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  ScrollView, Image, FlatList, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Spot, SpotDetails, SpotComment, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';
import { PhotoGalleryModal } from './PhotoGalleryModal';
import { useTheme } from '../../contexts/ThemeContext';

const API_URL = 'https://v-room.app/api/spots';

interface SpotDetailModalProps {
  visible: boolean; spot: Spot | null; onClose: () => void;
  getDistance: (spot: Spot) => number;
  onLikeToggle: (spotId: string, liked: boolean, count: number) => void;
}

export const SpotDetailModal = ({ visible, spot, onClose, getDistance, onLikeToggle }: SpotDetailModalProps) => {
  const router = useRouter();
  const { theme } = useTheme();

  const [details,        setDetails]        = useState<SpotDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [likeLoading,    setLikeLoading]    = useState(false);
  const [commentText,    setCommentText]    = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex,   setGalleryIndex]   = useState(0);
  const [myUserId,       setMyUserId]       = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) { const u = JSON.parse(raw); setMyUserId(u.userId ?? u.id); }
    });
  }, []);

  useEffect(() => {
    if (!visible || !spot) return;
    (async () => {
      setLoadingDetails(true);
      try {
        const token = await AsyncStorage.getItem('userToken');
        const res   = await fetch(`${API_URL}/${spot.id}/details`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setDetails({ ...spot, likesCount: data.likesCount, commentsCount: data.commentsCount, isLiked: data.isLiked, comments: data.comments || [], authorObj: data.author ?? null });
      } catch {
        setDetails({ ...spot, comments: [], authorObj: null });
      } finally { setLoadingDetails(false); }
    })();
  }, [visible, spot?.id]);

  useEffect(() => { if (!visible) { setDetails(null); setCommentText(''); } }, [visible]);

  const handleLike = useCallback(async () => {
    if (!details || likeLoading) return;
    setLikeLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      const res   = await fetch(`${API_URL}/${details.id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDetails(prev => prev ? { ...prev, isLiked: data.liked, likesCount: data.likesCount } : prev);
      onLikeToggle(details.id, data.liked, data.likesCount);
    } catch { Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie można dodać lajka' }); }
    finally { setLikeLoading(false); }
  }, [details, likeLoading, onLikeToggle]);

  const handleComment = useCallback(async () => {
    if (!commentText.trim() || !details || commentLoading) return;
    setCommentLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      const res   = await fetch(`${API_URL}/${details.id}/comments`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: commentText.trim() }) });
      if (!res.ok) throw new Error();
      const comment: SpotComment = await res.json();
      setDetails(prev => prev ? { ...prev, comments: [comment, ...prev.comments], commentsCount: prev.commentsCount + 1 } : prev);
      setCommentText('');
    } catch { Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie można dodać komentarza' }); }
    finally { setCommentLoading(false); }
  }, [commentText, details, commentLoading]);

  const handleNavigate = async () => {
    if (!spot) return;
    await AsyncStorage.setItem('nav_destination', JSON.stringify({ latitude: spot.latitude, longitude: spot.longitude, name: spot.name }));
    onClose(); router.push('/(tabs)/map');
    Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: spot.name });
  };

  const handleViewProfile = () => {
    const authorId = details?.authorObj?.id;
    if (!authorId) return;
    onClose(); router.push({ pathname: '/profile/[userId]', params: { userId: String(authorId) } });
  };

  if (!spot) return null;

  const color       = CATEGORY_COLORS[spot.category];
  const isLiked     = details?.isLiked    ?? spot.isLiked;
  const likesCount  = details?.likesCount ?? spot.likesCount;
  const authorObj   = details?.authorObj;
  const authorName  = authorObj?.username ?? spot.author;
  const isOwn       = myUserId != null && authorObj?.id === myUserId;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '88%' }}>

            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: color + '22', justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name={CATEGORY_ICONS[spot.category] as any} size={20} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{spot.name}</Text>
                  <Text style={{ color, fontSize: 11, fontWeight: '600', marginTop: 2 }}>{spot.category}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={24} color={theme.textDim} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* Zdjęcia */}
              {spot.photos.length > 0 && (
                <>
                  <FlatList
                    data={spot.photos.slice(0, 4)} keyExtractor={(item, i) => `${item}_${i}`}
                    horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}
                    renderItem={({ item, index }) => (
                      <TouchableOpacity onPress={() => { setGalleryIndex(index); setGalleryVisible(true); }} activeOpacity={0.9}>
                        <Image source={{ uri: item }} style={{ width: 160, height: 110, borderRadius: 12, marginRight: 8 }} />
                        {spot.photos.length > 4 && index === 3 && (
                          <View style={{ position: 'absolute', top: 0, left: 0, width: 160, height: 110, borderRadius: 12, backgroundColor: '#000000bb', justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>+{spot.photos.length - 4}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    )}
                  />
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12, marginTop: 4 }} onPress={() => { setGalleryIndex(0); setGalleryVisible(true); }} activeOpacity={0.8}>
                    <MaterialIcons name="photo-library" size={14} color={theme.textDim} />
                    <Text style={{ color: theme.textDim, fontSize: 11 }}>{spot.photos.length} {spot.photos.length === 1 ? 'zdjęcie' : 'zdjęcia'} · dotknij aby powiększyć</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Opis */}
              <Text style={{ color: spot.description ? theme.textMuted : theme.textDim, fontSize: 13, lineHeight: 20, marginBottom: 12 }}>
                {spot.description || 'Brak opisu'}
              </Text>

              {/* Autor */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface3, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border }}
                onPress={handleViewProfile} activeOpacity={authorObj?.id ? 0.75 : 1} disabled={!authorObj?.id}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primaryBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.primaryBorder, overflow: 'hidden' }}>
                  {authorObj?.avatarUrl
                    ? <Image source={{ uri: authorObj.avatarUrl }} style={{ width: 40, height: 40 }} />
                    : <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '700' }}>{authorName.charAt(0).toUpperCase()}</Text>
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.textDim, fontSize: 8, letterSpacing: 1, marginBottom: 2 }}>TWÓRCA SPOTU</Text>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{authorName}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ color: theme.textDim, fontSize: 10 }}>{new Date(spot.createdAt).toLocaleDateString('pl-PL')}</Text>
                </View>
                {!isOwn && authorObj?.id && <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textFaint} style={{ marginLeft: 6 }} />}
              </TouchableOpacity>

              {!isOwn && authorObj?.id && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.primaryBg, borderRadius: 12, paddingVertical: 10, marginBottom: 16, borderWidth: 1, borderColor: theme.primaryBorder }}
                  onPress={handleViewProfile} activeOpacity={0.8}
                >
                  <MaterialIcons name="person" size={16} color={theme.primary} />
                  <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>Zobacz profil {authorName}</Text>
                  <MaterialIcons name="arrow-forward" size={14} color={theme.primary} />
                </TouchableOpacity>
              )}

              {/* Akcje */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <TouchableOpacity
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border2 },
                    isLiked && { borderColor: theme.primaryBorder2, backgroundColor: theme.primaryBg }]}
                  onPress={handleLike} disabled={likeLoading} activeOpacity={0.8}
                >
                  {likeLoading
                    ? <ActivityIndicator size={16} color={isLiked ? theme.primary : theme.textDim} />
                    : <MaterialIcons name={isLiked ? 'favorite' : 'favorite-border'} size={20} color={isLiked ? theme.primary : theme.textDim} />
                  }
                  <Text style={{ color: isLiked ? theme.primary : theme.textDim, fontSize: 13, fontWeight: '600' }}>{likesCount}</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border2 }}>
                  <MaterialIcons name="chat-bubble-outline" size={18} color={theme.textDim} />
                  <Text style={{ color: theme.textDim, fontSize: 13 }}>{details?.commentsCount ?? spot.commentsCount}</Text>
                </View>

                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.primary, borderRadius: 12, height: 44 }}
                  onPress={handleNavigate} activeOpacity={0.85}
                >
                  <MaterialIcons name="navigation" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>NAWIGUJ</Text>
                </TouchableOpacity>
              </View>

              {/* Komentarze */}
              <Text style={{ color: theme.textDim, fontSize: 9, letterSpacing: 1, marginBottom: 12 }}>KOMENTARZE</Text>

              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 16 }}>
                <TextInput
                  style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: theme.text, fontSize: 13, borderWidth: 1, borderColor: theme.border2, maxHeight: 80 }}
                  placeholder="Dodaj komentarz..." placeholderTextColor={theme.textDim}
                  value={commentText} onChangeText={setCommentText} multiline maxLength={300}
                />
                <TouchableOpacity
                  style={[{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center' }, !commentText.trim() && { opacity: 0.4 }]}
                  onPress={handleComment} disabled={!commentText.trim() || commentLoading} activeOpacity={0.8}
                >
                  {commentLoading ? <ActivityIndicator size={16} color="#fff" /> : <MaterialIcons name="send" size={18} color="#fff" />}
                </TouchableOpacity>
              </View>

              {loadingDetails ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={theme.primary} /></View>
              ) : details?.comments.length === 0 ? (
                <View style={{ paddingVertical: 24, alignItems: 'center', gap: 8 }}>
                  <MaterialIcons name="chat-bubble-outline" size={32} color={theme.border3} />
                  <Text style={{ color: theme.textFaint, fontSize: 12 }}>Bądź pierwszy!</Text>
                </View>
              ) : (
                details?.comments.map(c => (
                  <View key={c.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.primaryBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
                      <Text style={{ color: theme.primary, fontSize: 14, fontWeight: '700' }}>{c.user.username.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{c.user.username}</Text>
                        <Text style={{ color: theme.textDim, fontSize: 10 }}>{new Date(c.createdAt).toLocaleDateString('pl-PL')}</Text>
                      </View>
                      <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 18 }}>{c.text}</Text>
                    </View>
                  </View>
                ))
              )}

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PhotoGalleryModal visible={galleryVisible} photos={spot.photos} initialIndex={galleryIndex} spotName={spot.name} onClose={() => setGalleryVisible(false)} />
    </>
  );
};