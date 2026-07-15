import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { SpotCategory, CATEGORIES, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';

interface AddSpotModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (name: string, description: string, category: SpotCategory, photos: string[]) => Promise<boolean>;
}

export const AddSpotModal = ({ visible, onClose, onAdd }: AddSpotModalProps) => {
  const { theme } = useTheme();
  const keyboardInset = useKeyboardInset(visible);
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState<SpotCategory>('Fotki');
  const [photos,      setPhotos]      = useState<string[]>([]);
  const [picking,     setPicking]     = useState(false);
  const [loading,     setLoading]     = useState(false);

  const handleClose = useCallback(() => {
    if (loading || picking) return;
    setName(''); setDescription(''); setCategory('Fotki'); setPhotos([]);
    onClose();
  }, [loading, picking, onClose]);

  const pickPhotos = useCallback(async () => {
    setPicking(true);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: 5,
    });
    if (!result.canceled) {
      const uris    = result.assets.map(a => a.uri);
      const limited = uris.slice(0, 5 - photos.length);
      setPhotos(prev => [...prev, ...limited].slice(0, 5));
    }
    setPicking(false);
  }, [photos]);

  const removePhoto = useCallback((index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj nazwę miejscówki' });
      return;
    }
    setLoading(true);
    try {
      const ok = await onAdd(name, description, category, photos);
      if (ok) { setName(''); setDescription(''); setCategory('Fotki'); setPhotos([]); onClose(); }
    } finally { setLoading(false); }
  }, [name, description, category, photos, onAdd, onClose]);

  const isBlocked = loading || picking;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={Platform.OS === 'ios'} style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' }}>

          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', letterSpacing: 1 }}>📍 NOWY SPOT</Text>
            <TouchableOpacity onPress={handleClose} disabled={isBlocked} activeOpacity={0.8}>
              <MaterialIcons name="close" size={24} color={isBlocked ? theme.textFaint : theme.textDim} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: keyboardInset > 0 ? keyboardInset + 16 : 8 }}
          >

            {/* Kategoria */}
            <Text style={{ color: theme.textDim, fontSize: 9, letterSpacing: 1, marginBottom: 8, marginTop: 16 }}>KATEGORIA</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                    backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border2,
                  }, category === cat && { backgroundColor: CATEGORY_COLORS[cat] + '33', borderColor: CATEGORY_COLORS[cat] }]}
                  onPress={() => setCategory(cat)} activeOpacity={0.8} disabled={isBlocked}
                >
                  <MaterialIcons name={CATEGORY_ICONS[cat] as any} size={15} color={category === cat ? CATEGORY_COLORS[cat] : theme.textDim} />
                  <Text style={{ color: category === cat ? CATEGORY_COLORS[cat] : theme.textDim, fontSize: 12, fontWeight: '600' }}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Nazwa */}
            <Text style={{ color: theme.textDim, fontSize: 9, letterSpacing: 1, marginBottom: 8, marginTop: 16 }}>NAZWA *</Text>
            <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface3, borderRadius: 12, paddingHorizontal: 14, height: 50, borderWidth: 1, borderColor: theme.border2 }, isBlocked && { opacity: 0.5 }]}>
              <MaterialIcons name="label-outline" size={18} color={theme.primary} />
              <TextInput
                style={{ flex: 1, color: theme.text, fontSize: 13, marginLeft: 10 }}
                placeholder="np. Widok na dolinę" placeholderTextColor={theme.textDim}
                value={name} onChangeText={setName} maxLength={50} editable={!isBlocked}
              />
            </View>

            {/* Opis */}
            <Text style={{ color: theme.textDim, fontSize: 9, letterSpacing: 1, marginBottom: 8, marginTop: 16 }}>OPIS</Text>
            <View style={[{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.surface3, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, height: 90, borderWidth: 1, borderColor: theme.border2 }, isBlocked && { opacity: 0.5 }]}>
              <MaterialIcons name="notes" size={18} color={theme.primary} style={{ marginTop: 2 }} />
              <TextInput
                style={{ flex: 1, color: theme.text, fontSize: 13, marginLeft: 10, height: 70, textAlignVertical: 'top' }}
                placeholder="Opisz to miejsce..." placeholderTextColor={theme.textDim}
                value={description} onChangeText={setDescription} multiline maxLength={200} editable={!isBlocked}
              />
            </View>

            {/* Zdjęcia */}
            <Text style={{ color: theme.textDim, fontSize: 9, letterSpacing: 1, marginBottom: 8, marginTop: 16 }}>
              ZDJĘCIA <Text style={{ color: theme.textFaint }}>(opcjonalnie, maks. 5)</Text>
            </Text>

            {photos.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {photos.map((uri, i) => (
                  <View key={uri} style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden' }}>
                    <Image source={{ uri }} style={{ width: 80, height: 80 }} resizeMode="cover" />
                    {!isBlocked && (
                      <TouchableOpacity
                        style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#000000cc', borderRadius: 8, padding: 3, zIndex: 10 }}
                        onPress={() => removePhoto(i)}
                      >
                        <MaterialIcons name="close" size={12} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}

            {photos.length < 5 && !loading && (
              <TouchableOpacity
                style={[{
                  borderWidth: 1.5, borderColor: theme.border3, borderStyle: 'dashed',
                  borderRadius: 12, height: 72, justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 4,
                }, picking && { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}
                onPress={pickPhotos} activeOpacity={0.8} disabled={picking}
              >
                {picking ? (
                  <><ActivityIndicator size="small" color={theme.primary} /><Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '600' }}>Wczytywanie zdjęć...</Text></>
                ) : (
                  <><MaterialIcons name="add-photo-alternate" size={28} color={theme.textDim} /><Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '600' }}>{photos.length === 0 ? 'Dodaj zdjęcia' : `Dodaj więcej (${photos.length}/5)`}</Text></>
                )}
              </TouchableOpacity>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.primary, borderRadius: 14, height: 52, marginTop: 20, marginBottom: 8 }, isBlocked && { opacity: 0.85 }]}
              onPress={handleSubmit} activeOpacity={0.85} disabled={isBlocked}
            >
              {loading ? (
                <><ActivityIndicator color="#fff" size={18} /><Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>ZAPISYWANIE...</Text></>
              ) : picking ? (
                <><ActivityIndicator color="#fff" size={18} /><Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>ŁADOWANIE ZDJĘĆ...</Text></>
              ) : (
                <><MaterialIcons name="add-location-alt" size={20} color="#fff" /><Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>DODAJ SPOT</Text></>
              )}
            </TouchableOpacity>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};
