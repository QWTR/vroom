import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { SpotCategory, CATEGORIES, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';

interface AddSpotModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (name: string, description: string, category: SpotCategory, photos: string[]) => Promise<boolean>;
}

export const AddSpotModal = ({ visible, onClose, onAdd }: AddSpotModalProps) => {
  const [name, setName]                 = useState('');
  const [description, setDescription]   = useState('');
  const [category, setCategory]         = useState<SpotCategory>('Fotki');
  const [photos, setPhotos]             = useState<string[]>([]);
  const [picking, setPicking]           = useState(false); // ✅ trwa wybieranie z galerii
  const [loading, setLoading]           = useState(false);

  const handleClose = useCallback(() => {
    if (loading || picking) return;
    setName('');
    setDescription('');
    setCategory('Fotki');
    setPhotos([]);
    onClose();
  }, [loading, picking, onClose]);

  const pickPhotos = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Toast.show({ type: 'error', text1: 'BRAK DOSTĘPU', text2: 'Zezwól na dostęp do zdjęć' });
      return;
    }

    // ✅ Pokaż "Ładowanie..." NA PRZYCISKU zanim otworzymy picker
    setPicking(true);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: 5,
    });

    if (!result.canceled) {
      const uris = result.assets.map(a => a.uri);
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
      if (ok) {
        setName('');
        setDescription('');
        setCategory('Fotki');
        setPhotos([]);
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }, [name, description, category, photos, onAdd, onClose]);

  const isBlocked = loading || picking;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.overlay}>
        <View style={s.container}>

          <View style={s.header}>
            <Text style={s.title}>📍 NOWY SPOT</Text>
            <TouchableOpacity onPress={handleClose} disabled={isBlocked} activeOpacity={0.8}>
              <MaterialIcons name="close" size={24} color={isBlocked ? '#ffffff20' : '#ffffff80'} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <Text style={s.label}>KATEGORIA</Text>
            <View style={s.categoryRow}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[s.chip, category === cat && { backgroundColor: CATEGORY_COLORS[cat] + '33', borderColor: CATEGORY_COLORS[cat] }]}
                  onPress={() => setCategory(cat)}
                  activeOpacity={0.8}
                  disabled={isBlocked}
                >
                  <MaterialIcons name={CATEGORY_ICONS[cat] as any} size={15} color={category === cat ? CATEGORY_COLORS[cat] : '#ffffff50'} />
                  <Text style={[s.chipText, category === cat && { color: CATEGORY_COLORS[cat] }]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>NAZWA *</Text>
            <View style={[s.inputWrapper, isBlocked && { opacity: 0.5 }]}>
              <MaterialIcons name="label-outline" size={18} color="#e33835" />
              <TextInput
                style={s.input}
                placeholder="np. Widok na dolinę"
                placeholderTextColor="#ffffff30"
                value={name}
                onChangeText={setName}
                maxLength={50}
                editable={!isBlocked}
              />
            </View>

            <Text style={s.label}>OPIS</Text>
            <View style={[s.inputWrapper, { height: 90, alignItems: 'flex-start', paddingTop: 12 }, isBlocked && { opacity: 0.5 }]}>
              <MaterialIcons name="notes" size={18} color="#e33835" style={{ marginTop: 2 }} />
              <TextInput
                style={[s.input, { height: 70, textAlignVertical: 'top' }]}
                placeholder="Opisz to miejsce..."
                placeholderTextColor="#ffffff30"
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={200}
                editable={!isBlocked}
              />
            </View>

            <Text style={s.label}>
              ZDJĘCIA <Text style={{ color: '#ffffff30' }}>(opcjonalnie, maks. 5)</Text>
            </Text>

            {/* Zdjęcia */}
            {photos.length > 0 && (
              <View style={s.photosGrid}>
                {photos.map((uri, i) => (
                  <View key={uri} style={s.photoSlot}>
                    <Image source={{ uri }} style={s.photoImage} resizeMode="cover" />
                    {!isBlocked && (
                      <TouchableOpacity style={s.photoRemove} onPress={() => removePhoto(i)}>
                        <MaterialIcons name="close" size={12} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* ✅ Przycisk — podczas picking pokazuje spinner */}
            {photos.length < 5 && !loading && (
              <TouchableOpacity
                style={[s.photoBtn, picking && s.photoBtnLoading]}
                onPress={pickPhotos}
                activeOpacity={0.8}
                disabled={picking}
              >
                {picking ? (
                  <>
                    <ActivityIndicator size="small" color="#e33835" />
                    <Text style={s.photoBtnText}>Wczytywanie zdjęć...</Text>
                  </>
                ) : (
                  <>
                    <MaterialIcons name="add-photo-alternate" size={28} color="#ffffff30" />
                    <Text style={s.photoBtnText}>
                      {photos.length === 0 ? 'Dodaj zdjęcia' : `Dodaj więcej (${photos.length}/5)`}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[s.submitBtn, isBlocked && { opacity: 0.85 }]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={isBlocked}
            >
              {loading ? (
                <View style={s.submitInner}>
                  <ActivityIndicator color="#fff" size={18} />
                  <Text style={s.submitBtnText}>ZAPISYWANIE...</Text>
                </View>
              ) : picking ? (
                <View style={s.submitInner}>
                  <ActivityIndicator color="#fff" size={18} />
                  <Text style={s.submitBtnText}>ŁADOWANIE ZDJĘĆ...</Text>
                </View>
              ) : (
                <View style={s.submitInner}>
                  <MaterialIcons name="add-location-alt" size={20} color="#fff" />
                  <Text style={s.submitBtnText}>DODAJ SPOT</Text>
                </View>
              )}
            </TouchableOpacity>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  container:      { backgroundColor: '#161616', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title:          { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  label:          { color: '#ffffff50', fontSize: 9, letterSpacing: 1, marginBottom: 8, marginTop: 16 },
  inputWrapper:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 14, height: 50, borderWidth: 1, borderColor: '#ffffff10' },
  input:          { flex: 1, color: '#fff', fontSize: 13, marginLeft: 10 },
  categoryRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#ffffff15' },
  chipText:       { color: '#ffffff50', fontSize: 12, fontWeight: '600' },
  photosGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  photoSlot:      { width: 80, height: 80, borderRadius: 10, overflow: 'hidden' },
  photoImage:     { width: 80, height: 80 },
  photoRemove:    { position: 'absolute', top: 4, right: 4, backgroundColor: '#000000cc', borderRadius: 8, padding: 3, zIndex: 10 },
  photoBtn:       { borderWidth: 1.5, borderColor: '#ffffff15', borderStyle: 'dashed', borderRadius: 12, height: 72, justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 4 },
  photoBtnLoading:{ borderColor: '#e3383530', backgroundColor: '#e3383510' },
  photoBtnText:   { color: '#ffffff40', fontSize: 12, fontWeight: '600' },
  submitBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#e33835', borderRadius: 14, height: 52, marginTop: 20, marginBottom: 8 },
  submitInner:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  submitBtnText:  { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
});