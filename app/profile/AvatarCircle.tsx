import React from 'react';
import {
  View, Image, TouchableOpacity, ActivityIndicator,
  Alert, ActionSheetIOS, Platform, Text,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../contexts/ThemeContext';
import { launchRecoverableCameraAsync, useRecoveredImagePickerResult } from '../../lib/recoverableImagePicker';

const CAMERA_PURPOSE = 'profile-avatar-circle';

interface Props {
  initials:       string;
  avatarUrl?:     string | null;
  uploading?:     boolean;
  onCameraPress?: (uri: string) => void;
}

export default function AvatarCircle({ initials, avatarUrl, uploading = false, onCameraPress }: Props) {
  const { theme } = useTheme();
  useRecoveredImagePickerResult(CAMERA_PURPOSE, (result) => {
    if (!result.canceled && result.assets?.[0]?.uri) onCameraPress?.(result.assets[0].uri);
  });

  const openPicker = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Brak uprawnień', 'Zezwól na dostęp do aparatu.'); return; }
        result = await launchRecoverableCameraAsync(CAMERA_PURPOSE, { allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      }
      if (!result.canceled && result.assets?.[0]?.uri) onCameraPress?.(result.assets[0].uri);
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie można otworzyć galerii');
    }
  };

  const handlePress = () => {
    if (!onCameraPress) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Anuluj', 'Zrób zdjęcie', 'Wybierz z galerii'], cancelButtonIndex: 0 },
        idx => { if (idx === 1) openPicker(true); if (idx === 2) openPicker(false); },
      );
    } else {
      Alert.alert('Zdjęcie profilowe', 'Wybierz źródło', [
        { text: 'Aparat',  onPress: () => openPicker(true)  },
        { text: 'Galeria', onPress: () => openPicker(false) },
        { text: 'Anuluj',  style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={{ position: 'relative' }}>
      <View style={{
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: theme.surface3,
        borderWidth: 2, borderColor: theme.primary,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: theme.primary, shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5, shadowRadius: 10, overflow: 'hidden',
      }}>
        {uploading
          ? <ActivityIndicator color={theme.primary} size="large" />
          : avatarUrl
          ? <Image source={{ uri: avatarUrl }} style={{ width: 80, height: 80 }} onError={() => {}} />
          : <Text style={{ fontFamily: 'Orbitron', fontSize: 24, color: theme.primary }}>{initials}</Text>
        }
      </View>
      {!!onCameraPress && !uploading && (
        <TouchableOpacity
          style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: theme.primary, padding: 6, borderRadius: 15, borderWidth: 2, borderColor: theme.surface3 }}
          onPress={handlePress}
        >
          <MaterialIcons name="photo-camera" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}
