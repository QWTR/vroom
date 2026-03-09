import React, { useState } from 'react';
import {
  TouchableOpacity, Image, View, StyleSheet, Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import type { SpotPreview } from '../../constants/profile';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface Props {
  spot:       SpotPreview;
  isOwner?:   boolean;
  onPress:    () => void;
  onDeleted?: (id: number) => void;
}

export default function SpotPreviewCard({ spot, isOwner = false, onPress, onDeleted }: Props) {
  const router     = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const thumb = spot.photos?.[0];

  const handleDelete = async () => {
    setMenuOpen(false);
    setDeleting(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/spots/${spot.id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd serwera');
      Toast.show({ type: 'success', text1: '🗑️ USUNIĘTO', text2: spot.name });
      onDeleted?.(spot.id);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = () => {
    setMenuOpen(false);
    router.push({
      pathname: '/profile/edit-spot',
      params: {
        id:          String(spot.id),
        name:        spot.name,
        description: spot.description ?? '',
        category:    spot.category,
        photos:      JSON.stringify(spot.photos ?? []),
      },
    });
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <MaterialIcons name="place" size={28} color="#e33835" />
          </View>
        )}

        {/* Nakładka ładowania */}
        {deleting && (
          <View style={styles.deletingOverlay}>
            <MaterialIcons name="delete" size={24} color="#e33835" />
          </View>
        )}

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{spot.name}</Text>
          <Text style={styles.category}>{spot.category}</Text>
          <View style={styles.row}>
            <MaterialIcons name="favorite" size={12} color={spot.isLiked ? '#e33835' : '#ffffff40'} />
            <Text style={styles.count}>{spot.likesCount}</Text>
            <MaterialIcons name="chat-bubble" size={12} color="#ffffff40" style={{ marginLeft: 8 }} />
            <Text style={styles.count}>{spot.commentsCount}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Przycisk menu – tylko dla właściciela */}
      {isOwner && (
        <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen(true)}>
          <MaterialIcons name="more-vert" size={18} color="#ffffff60" />
        </TouchableOpacity>
      )}

      {/* Menu kontekstowe */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
          <View style={styles.menuOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.menuBox}>
                <Text style={styles.menuTitle} numberOfLines={1}>{spot.name}</Text>

                <TouchableOpacity style={styles.menuItem} onPress={handleEdit}>
                  <MaterialIcons name="edit" size={20} color="#fff" />
                  <Text style={styles.menuItemText}>Edytuj spot</Text>
                </TouchableOpacity>

                <View style={styles.menuDivider} />

                <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
                  <MaterialIcons name="delete-outline" size={20} color="#e33835" />
                  <Text style={[styles.menuItemText, { color: '#e33835' }]}>Usuń spot</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuCancel} onPress={() => setMenuOpen(false)}>
                  <Text style={styles.menuCancelText}>Anuluj</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:         { width: '48%', marginBottom: 10, position: 'relative' },
  card:            { backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff05' },
  image:           { width: '100%', height: 110 },
  imagePlaceholder:{ width: '100%', height: 110, backgroundColor: '#252525', justifyContent: 'center', alignItems: 'center' },
  deletingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000aa', justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  info:            { padding: 10 },
  name:            { fontFamily: 'Orbitron', color: '#fff', fontSize: 11, marginBottom: 2 },
  category:        { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginBottom: 6 },
  row:             { flexDirection: 'row', alignItems: 'center' },
  count:           { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, marginLeft: 3 },

  // Przycisk menu
  menuBtn:         { position: 'absolute', top: 6, right: 6, backgroundColor: '#00000060', borderRadius: 12, padding: 2 },

  // Modal menu
  menuOverlay:     { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  menuBox:         { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  menuTitle:       { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 11, marginBottom: 16, textAlign: 'center' },
  menuItem:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuItemText:    { fontFamily: 'Orbitron', color: '#fff', fontSize: 14 },
  menuDivider:     { height: 1, backgroundColor: '#ffffff10', marginVertical: 4 },
  menuCancel:      { marginTop: 8, paddingVertical: 14, alignItems: 'center', backgroundColor: '#252525', borderRadius: 10 },
  menuCancelText:  { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 13 },
});