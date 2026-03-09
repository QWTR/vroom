import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  Image, TextInput, ActivityIndicator, FlatList,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../constants/config';
import { PhotoGalleryModal } from '../../components/spots/PhotoGalleryModal';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface CarDetail {
  id:            number;
  brand:         string;
  specs:         string;
  isMain:        boolean;
  photos:        string[];
  ownerId:       number;
  owner:         { id: number; username: string; avatarUrl: string | null };
  likesCount:    number;
  commentsCount: number;
  isLiked:       boolean;
  comments:      CarComment[];
}

interface CarComment {
  id:        number;
  text:      string;
  createdAt: string;
  user:      { id: number; username: string; avatarUrl: string | null };
}

export default function CarDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [car,            setCar]            = useState<CarDetail | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [likeLoading,    setLikeLoading]    = useState(false);
  const [commentText,    setCommentText]    = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex,   setGalleryIndex]   = useState(0);
  const [myUserId,       setMyUserId]       = useState<number | null>(null);

  useEffect(() => {
    const init = async () => {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        setMyUserId(u.userId ?? u.id);
      }
      fetchCar();
    };
    init();
  }, [id]);

  const fetchCar = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/cars/${id}`, { headers });
      if (!res.ok) throw new Error('Błąd pobierania auta');
      setCar(await res.json());
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleLike = useCallback(async () => {
    if (!car || likeLoading) return;
    setLikeLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/cars/${car.id}/like`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCar(prev => prev ? { ...prev, isLiked: data.liked, likesCount: data.likesCount } : prev);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można dodać lajka.' });
    } finally {
      setLikeLoading(false);
    }
  }, [car, likeLoading]);

  const handleComment = useCallback(async () => {
    if (!commentText.trim() || !car || commentLoading) return;
    setCommentLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/cars/${car.id}/comments`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: commentText.trim() }),
      });
      if (!res.ok) throw new Error();
      const comment: CarComment = await res.json();
      setCar(prev => prev
        ? { ...prev, comments: [comment, ...prev.comments], commentsCount: prev.commentsCount + 1 }
        : prev
      );
      setCommentText('');
      Toast.show({ type: 'success', text1: '💬 DODANO', text2: 'Komentarz dodany!' });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można dodać komentarza.' });
    } finally {
      setCommentLoading(false);
    }
  }, [commentText, car, commentLoading]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e33835" />
      </View>
    );
  }

  if (!car) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontFamily: 'Orbitron' }}>Nie znaleziono auta</Text>
      </View>
    );
  }

  const isOwner = myUserId === car.ownerId;

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* NAGŁÓWEK */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backBtn}>← Wróć</Text>
          </TouchableOpacity>
          {isOwner && (
            <TouchableOpacity style={styles.deleteBtn} onPress={async () => {
              try {
                const token = await getToken();
                const res   = await fetch(`${API_URL}/api/cars/${car.id}`, {
                  method:  'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) throw new Error();
                Toast.show({ type: 'success', text1: '🗑️ USUNIĘTO', text2: car.brand });
                router.back();
              } catch {
                Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można usunąć auta.' });
              }
            }}>
              <MaterialIcons name="delete-outline" size={22} color="#e33835" />
            </TouchableOpacity>
          )}
        </View>

        {/* ZDJĘCIA */}
        {car.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosRow}>
            {car.photos.map((photo, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => { setGalleryIndex(i); setGalleryVisible(true); }}
                activeOpacity={0.9}
              >
                <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.noPhoto}>
            <MaterialIcons name="directions-car" size={48} color="#e33835" />
          </View>
        )}

        {/* INFO */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            {car.isMain && (
              <View style={styles.mainBadge}>
                <Text style={styles.mainBadgeText}>GŁÓWNE</Text>
              </View>
            )}
          </View>
          <Text style={styles.carBrand}>{car.brand}</Text>
          <Text style={styles.carSpecs}>{car.specs}</Text>

          {/* Właściciel */}
          <TouchableOpacity
            style={styles.ownerRow}
            onPress={() => router.push({ pathname: '/profile/[id]', params: { id: String(car.ownerId) } })}
          >
            <View style={styles.ownerAvatar}>
              {car.owner.avatarUrl ? (
                <Image source={{ uri: car.owner.avatarUrl }} style={styles.ownerAvatarImg} />
              ) : (
                <Text style={styles.ownerAvatarText}>
                  {car.owner.username.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <Text style={styles.ownerName}>{car.owner.username}</Text>
            <MaterialIcons name="arrow-forward-ios" size={12} color="#ffffff40" />
          </TouchableOpacity>
        </View>

        {/* AKCJE – lajk */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.likeBtn, car.isLiked && styles.likeBtnActive]}
            onPress={handleLike}
            disabled={likeLoading}
            activeOpacity={0.8}
          >
            {likeLoading
              ? <ActivityIndicator size={16} color={car.isLiked ? '#e33835' : '#ffffff60'} />
              : <MaterialIcons
                  name={car.isLiked ? 'favorite' : 'favorite-border'}
                  size={20}
                  color={car.isLiked ? '#e33835' : '#ffffff60'}
                />
            }
            <Text style={[styles.likeBtnText, car.isLiked && { color: '#e33835' }]}>
              {car.likesCount}
            </Text>
          </TouchableOpacity>

          <View style={styles.commentsCountBtn}>
            <MaterialIcons name="chat-bubble-outline" size={18} color="#ffffff40" />
            <Text style={styles.commentsCountText}>{car.commentsCount}</Text>
          </View>
        </View>

        {/* KOMENTARZE */}
        <Text style={styles.sectionTitle}>KOMENTARZE</Text>

        {/* Pole komentarza */}
        <View style={styles.commentInputRow}>
          <TextInput
            style={styles.commentInput}
            placeholder="Dodaj komentarz..."
            placeholderTextColor="#ffffff30"
            value={commentText}
            onChangeText={setCommentText}
            multiline
            maxLength={300}
          />
          <TouchableOpacity
            style={[styles.commentSendBtn, !commentText.trim() && { opacity: 0.4 }]}
            onPress={handleComment}
            disabled={!commentText.trim() || commentLoading}
          >
            {commentLoading
              ? <ActivityIndicator size={16} color="#fff" />
              : <MaterialIcons name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>

        {/* Lista komentarzy */}
        {car.comments.length === 0 ? (
          <View style={styles.commentsEmpty}>
            <MaterialIcons name="chat-bubble-outline" size={32} color="#ffffff15" />
            <Text style={styles.commentsEmptyText}>Bądź pierwszy!</Text>
          </View>
        ) : (
          car.comments.map(c => (
            <View key={c.id} style={styles.commentItem}>
              <View style={styles.commentAvatar}>
                <Text style={styles.commentAvatarText}>
                  {c.user.username.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.commentHeader}>
                  <Text style={styles.commentUsername}>{c.user.username}</Text>
                  <Text style={styles.commentDate}>
                    {new Date(c.createdAt).toLocaleDateString('pl-PL')}
                  </Text>
                </View>
                <Text style={styles.commentText}>{c.text}</Text>
              </View>
            </View>
          ))
        )}

      </ScrollView>

      {/* GALERIA */}
      <PhotoGalleryModal
        visible={galleryVisible}
        photos={car.photos}
        initialIndex={galleryIndex}
        spotName={car.brand}
        onClose={() => setGalleryVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:         { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backBtn:           { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },
  deleteBtn:         { padding: 4 },
  photosRow:         { marginBottom: 20 },
  photo:             { width: 280, height: 200, borderRadius: 16, marginRight: 12 },
  noPhoto:           { height: 200, backgroundColor: '#1a1a1a', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  infoCard:          { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#ffffff10' },
  infoRow:           { flexDirection: 'row', marginBottom: 8 },
  mainBadge:         { backgroundColor: '#e3383520', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#e33835' },
  mainBadgeText:     { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 },
  carBrand:          { fontFamily: 'Orbitron', color: '#fff', fontSize: 22, marginBottom: 6 },
  carSpecs:          { fontFamily: 'Orbitron', color: '#e33835', fontSize: 13, marginBottom: 16 },
  ownerRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#252525', padding: 10, borderRadius: 10 },
  ownerAvatar:       { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center' },
  ownerAvatarImg:    { width: 32, height: 32, borderRadius: 16 },
  ownerAvatarText:   { fontFamily: 'Orbitron', color: '#e33835', fontSize: 13 },
  ownerName:         { fontFamily: 'Orbitron', color: '#fff', fontSize: 12, flex: 1 },
  actionsRow:        { flexDirection: 'row', gap: 10, marginBottom: 24 },
  likeBtn:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff10' },
  likeBtnActive:     { borderColor: '#e3383540', backgroundColor: '#e3383515' },
  likeBtnText:       { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 13 },
  commentsCountBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff10' },
  commentsCountText: { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 13 },
  sectionTitle:      { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, letterSpacing: 1, marginBottom: 12 },
  commentInputRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 16 },
  commentInput:      { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#ffffff10', maxHeight: 80 },
  commentSendBtn:    { width: 44, height: 44, borderRadius: 12, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' },
  commentsEmpty:     { paddingVertical: 24, alignItems: 'center', gap: 8 },
  commentsEmptyText: { fontFamily: 'Orbitron', color: '#ffffff20', fontSize: 12 },
  commentItem:       { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commentAvatar:     { width: 34, height: 34, borderRadius: 17, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e3383540' },
  commentAvatarText: { fontFamily: 'Orbitron', color: '#e33835', fontSize: 14, fontWeight: '700' },
  commentHeader:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  commentUsername:   { fontFamily: 'Orbitron', color: '#fff', fontSize: 12, fontWeight: '700' },
  commentDate:       { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 10 },
  commentText:       { color: '#ffffffaa', fontSize: 13, lineHeight: 18 },
});