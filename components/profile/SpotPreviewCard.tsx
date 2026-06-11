import React, { useState } from 'react';
import {
  TouchableOpacity, Image, View, Text, Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import type { SpotPreview } from '../../constants/profile';
import { useTheme } from '../../contexts/ThemeContext';
import { GLASS_SHADOW, resolveProfileCardTheme, type ProfileCardTheme } from './profileCardTheme';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface Props {
  spot:       SpotPreview;
  isOwner?:   boolean;
  onPress:    () => void;
  onDeleted?: (id: number) => void;
  theme?:     ProfileCardTheme;
}

export default function SpotPreviewCard({ spot, isOwner = false, onPress, onDeleted, theme: profileTheme }: Props) {
  const router = useRouter();
  const { theme: globalTheme } = useTheme();
  const theme = resolveProfileCardTheme(globalTheme, profileTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const thumb = spot.photos?.[0];

  const handleDelete = async () => {
    setMenuOpen(false);
    setDeleting(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/spots/${spot.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Błąd serwera');
      Toast.show({ type: 'success', text1: '🗑️ USUNIĘTO', text2: spot.name });
      onDeleted?.(spot.id);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally { setDeleting(false); }
  };

  const handleEdit = () => {
    setMenuOpen(false);
    router.push({ pathname: '/profile/edit-spot', params: { id: String(spot.id), name: spot.name, description: spot.description ?? '', category: spot.category, photos: JSON.stringify(spot.photos ?? []) } });
  };

  return (
    <View style={{ width: '48%', marginBottom: 16, position: 'relative' }}>
      <TouchableOpacity
        style={{
          backgroundColor: theme.surface,
          borderRadius: 20,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.border,
          ...GLASS_SHADOW,
        }}
        onPress={onPress}
        activeOpacity={0.8}
      >
        {thumb ? (
          <Image source={{ uri: thumb }} style={{ width: '100%', height: 110 }} resizeMode="cover" />
        ) : (
          <View style={{ width: '100%', height: 110, backgroundColor: theme.surface3, justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name="place" size={28} color={theme.primary} />
          </View>
        )}
        {deleting && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000aa', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name="delete" size={24} color={theme.primary} />
          </View>
        )}
        <View style={{ padding: 12 }}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, marginBottom: 2 }} numberOfLines={1}>{spot.name}</Text>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 10, letterSpacing: 0.5, marginBottom: 6 }}>{spot.category}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialIcons name="favorite" size={12} color={spot.isLiked ? theme.primary : theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginLeft: 3 }}>{spot.likesCount}</Text>
            <MaterialIcons name="chat-bubble" size={12} color={theme.textDim} style={{ marginLeft: 8 }} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginLeft: 3 }}>{spot.commentsCount}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {isOwner && (
        <TouchableOpacity style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#00000060', borderRadius: 12, padding: 2 }} onPress={() => setMenuOpen(true)}>
          <MaterialIcons name="more-vert" size={18} color="#ffffff60" />
        </TouchableOpacity>
      )}

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
          <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
            <TouchableWithoutFeedback>
              <View style={{
                backgroundColor: theme.surface,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 20,
                paddingBottom: 34,
                borderWidth: 1,
                borderColor: theme.border,
                ...GLASS_SHADOW,
              }}>
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11, marginBottom: 16, textAlign: 'center' }} numberOfLines={1}>{spot.name}</Text>
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }} onPress={handleEdit}>
                  <MaterialIcons name="edit" size={20} color={theme.text} />
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14 }}>Edytuj spot</Text>
                </TouchableOpacity>
                <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 4 }} />
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }} onPress={handleDelete}>
                  <MaterialIcons name="delete-outline" size={20} color={theme.primary} />
                  <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 14 }}>Usuń spot</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ marginTop: 8, paddingVertical: 14, alignItems: 'center', backgroundColor: theme.surface3, borderRadius: 12, borderWidth: 1, borderColor: theme.border }} onPress={() => setMenuOpen(false)}>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 13 }}>Anuluj</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}
