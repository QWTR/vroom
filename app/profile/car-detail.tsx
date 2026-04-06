import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, TouchableOpacity,
  Image, TextInput, ActivityIndicator, Modal, Pressable, Text,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons             from '@expo/vector-icons/MaterialIcons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage              from '@react-native-async-storage/async-storage';
import Toast                     from 'react-native-toast-message';
import { API_URL }               from '../../constants/config';
import { useTheme }              from '../../contexts/ThemeContext';
import { PhotoGalleryModal }     from '../../components/spots/PhotoGalleryModal';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface CarDetail {
  id:                number;
  brand:             string;
  specs:             string;
  isMain:            boolean;
  photos:            string[];
  ownerId:           number;
  owner:             { id: number; username: string; avatarUrl: string | null };
  likesCount:        number;
  commentsCount:     number;
  isLiked:           boolean;
  sharedToCommunity: boolean;
  comments:          CarComment[];
}
interface CarComment {
  id:        number;
  text:      string;
  createdAt: string;
  user:      { id: number; username: string; avatarUrl: string | null };
}

export default function CarDetailScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [car,            setCar]            = useState<CarDetail | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [likeLoading,    setLikeLoading]    = useState(false);
  const [commentText,    setCommentText]    = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex,   setGalleryIndex]   = useState(0);
  const [myUserId,       setMyUserId]       = useState<number | null>(null);
  const [deleteModal,    setDeleteModal]    = useState(false);
  const [deleting,       setDeleting]       = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      if (raw) { const u = JSON.parse(raw); setMyUserId(u.userId ?? u.id); }
      fetchCar();
    })();
  }, [id]);

  const fetchCar = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_URL}/api/cars/${id}`, { headers });
      if (!res.ok) throw new Error('Błąd pobierania auta');
      setCar(await res.json());
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!car) return;
    setDeleting(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/cars/${car.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      Toast.show({ type: 'success', text1: '🗑️ USUNIĘTO', text2: car.brand });
      router.back();
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można usunąć auta.' });
    } finally { setDeleting(false); setDeleteModal(false); }
  };

  const handleLike = useCallback(async () => {
    if (!car || likeLoading) return;
    setLikeLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/cars/${car.id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCar(prev => prev ? { ...prev, isLiked: data.liked, likesCount: data.likesCount } : prev);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można dodać lajka.' });
    } finally { setLikeLoading(false); }
  }, [car, likeLoading]);

  const handleComment = useCallback(async () => {
    if (!commentText.trim() || !car || commentLoading) return;
    setCommentLoading(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/cars/${car.id}/comments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (!res.ok) throw new Error();
      const comment: CarComment = await res.json();
      setCar(prev => prev ? { ...prev, comments: [comment, ...prev.comments], commentsCount: prev.commentsCount + 1 } : prev);
      setCommentText('');
      Toast.show({ type: 'success', text1: '💬 DODANO', text2: 'Komentarz dodany!' });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można dodać komentarza.' });
    } finally { setCommentLoading(false); }
  }, [commentText, car, commentLoading]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );

  if (!car) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: theme.text, fontFamily: 'Orbitron' }}>Nie znaleziono auta</Text>
    </View>
  );

  const isOwner = myUserId === car.ownerId;

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* NAGŁÓWEK */}
        <View style={{ marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
          </TouchableOpacity>
          {isOwner && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.surface4, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: theme.border2 }}
                onPress={() => router.push({ pathname: '/profile/edit-car', params: { id: String(car.id) } })}
                activeOpacity={0.8}
              >
                <MaterialIcons name="edit" size={16} color={theme.text} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 10, fontWeight: '700' }}>EDYTUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ padding: 7, backgroundColor: theme.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: theme.primaryBorder }}
                onPress={() => setDeleteModal(true)} activeOpacity={0.8}
              >
                <MaterialIcons name="delete-outline" size={18} color={theme.primary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ZDJĘCIA */}
        {car.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {car.photos.map((photo, i) => (
              <TouchableOpacity key={i} onPress={() => { setGalleryIndex(i); setGalleryVisible(true); }} activeOpacity={0.9}>
                <Image source={{ uri: photo }} style={{ width: 280, height: 200, borderRadius: 16, marginRight: 12 }} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={{ height: 200, backgroundColor: theme.surface3, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
            <MaterialIcons name="directions-car" size={48} color={theme.primary} />
          </View>
        )}

        {/* INFO */}
        <View style={{ backgroundColor: theme.surface3, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: theme.border }}>
          {car.isMain && (
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              <View style={{ backgroundColor: theme.primaryBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.primaryBorder }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 9 }}>GŁÓWNE</Text>
              </View>
            </View>
          )}
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 22, marginBottom: 6 }}>{car.brand}</Text>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 13, marginBottom: 16 }}>{car.specs}</Text>

          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.surface4, padding: 10, borderRadius: 10 }}
            onPress={() => router.push({ pathname: '/profile/[id]', params: { id: String(car.ownerId) } })}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.primaryBg, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
              {car.owner.avatarUrl
                ? <Image source={{ uri: car.owner.avatarUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} />
                : <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 13 }}>{car.owner.username.charAt(0).toUpperCase()}</Text>
              }
            </View>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12, flex: 1 }}>{car.owner.username}</Text>
            <MaterialIcons name="arrow-forward-ios" size={12} color={theme.textFaint} />
          </TouchableOpacity>
        </View>

        {/* AKCJE */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
          <TouchableOpacity
            style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border },
              car.isLiked && { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}
            onPress={handleLike} disabled={likeLoading} activeOpacity={0.8}
          >
            {likeLoading
              ? <ActivityIndicator size={16} color={car.isLiked ? theme.primary : theme.textDim} />
              : <MaterialIcons name={car.isLiked ? 'favorite' : 'favorite-border'} size={20} color={car.isLiked ? theme.primary : theme.textDim} />
            }
            <Text style={{ fontFamily: 'Orbitron', color: car.isLiked ? theme.primary : theme.textDim, fontSize: 13 }}>{car.likesCount}</Text>
          </TouchableOpacity>

          {isOwner && (
            <TouchableOpacity
              style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border },
                car.sharedToCommunity && { borderColor: '#4de92640', backgroundColor: '#4de92615' }]}
              onPress={async () => {
                try {
                  const token = await getToken();
                  const res   = await fetch(`${API_URL}/api/cars/${car.id}/share-community`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                  const data  = await res.json();
                  setCar(prev => prev ? { ...prev, sharedToCommunity: data.sharedToCommunity } : prev);
                  Toast.show({ type: 'success', text1: data.sharedToCommunity ? '🚗 UDOSTĘPNIONO' : 'UKRYTO', text2: data.sharedToCommunity ? 'Auto widoczne w Społeczności' : 'Auto ukryte ze Społeczności' });
                } catch { Toast.show({ type: 'error', text1: 'BŁĄD' }); }
              }}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="account-group" size={18} color={car.sharedToCommunity ? '#4de926' : theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', color: car.sharedToCommunity ? '#4de926' : theme.textDim, fontSize: 9 }}>
                {car.sharedToCommunity ? 'SPOŁECZNOŚĆ ✓' : 'SPOŁECZNOŚĆ'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border }}>
            <MaterialIcons name="chat-bubble-outline" size={18} color={theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 13 }}>{car.commentsCount}</Text>
          </View>
        </View>

        {/* KOMENTARZE */}
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, letterSpacing: 1, marginBottom: 12 }}>KOMENTARZE</Text>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 16 }}>
          <TextInput
            style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: theme.text, fontSize: 13, borderWidth: 1, borderColor: theme.border, maxHeight: 80 }}
            placeholder="Dodaj komentarz..."
            placeholderTextColor={theme.textFaint}
            value={commentText}
            onChangeText={setCommentText}
            multiline maxLength={300}
          />
          <TouchableOpacity
            style={[{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center' }, !commentText.trim() && { opacity: 0.4 }]}
            onPress={handleComment} disabled={!commentText.trim() || commentLoading}
          >
            {commentLoading
              ? <ActivityIndicator size={16} color="#fff" />
              : <MaterialIcons name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>

        {car.comments.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: 'center', gap: 8 }}>
            <MaterialIcons name="chat-bubble-outline" size={32} color={theme.border3} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 12 }}>Bądź pierwszy!</Text>
          </View>
        ) : (
          car.comments.map(c => (
            <View key={c.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.primaryBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 14, fontWeight: '700' }}>{c.user.username.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12, fontWeight: '700' }}>{c.user.username}</Text>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 10 }}>{new Date(c.createdAt).toLocaleDateString('pl-PL')}</Text>
                </View>
                <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 18 }}>{c.text}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <PhotoGalleryModal visible={galleryVisible} photos={car.photos} initialIndex={galleryIndex} spotName={car.brand} onClose={() => setGalleryVisible(false)} />

      {/* MODAL USUŃ */}
      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 }} onPress={() => setDeleteModal(false)}>
          <Pressable style={{ backgroundColor: theme.surface2, borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: theme.border2, alignItems: 'center' }} onPress={() => {}}>
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: theme.primaryBg, justifyContent: 'center', alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: theme.primaryBorder }}>
              <MaterialIcons name="delete-forever" size={34} color={theme.primary} />
            </View>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 15, letterSpacing: 2, marginBottom: 10 }}>USUŃ AUTO</Text>
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 22, textAlign: 'center', marginBottom: 24 }}>
              Czy na pewno chcesz usunąć{'\n'}
              <Text style={{ color: theme.text, fontWeight: '700' }}>{car.brand}</Text>
              {'\n'}
              <Text style={{ color: theme.primary }}>Tej operacji nie można cofnąć.</Text>
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: theme.surface4, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: theme.border2 }} onPress={() => setDeleteModal(false)} activeOpacity={0.8}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12 }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ flex: 1, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, deleting && { opacity: 0.6 }]}
                onPress={handleDelete} disabled={deleting} activeOpacity={0.8}
              >
                {deleting
                  ? <ActivityIndicator size={14} color="#fff" />
                  : <><MaterialIcons name="delete" size={15} color="#fff" /><Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 12 }}>USUŃ</Text></>
                }
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}