import React from 'react';
import {
  View, Image, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ActionSheetIOS, Platform,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';

interface Props {
  initials:       string;
  avatarUrl?:     string | null;
  uploading?:     boolean;
  onCameraPress?: (uri: string) => void;
}

export default function AvatarCircle({
  initials, avatarUrl, uploading = false, onCameraPress,
}: Props) {

  const openPicker = async (useCamera: boolean) => {
    try {
      let result;

      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Brak uprawnień', 'Zezwól na dostęp do aparatu.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect:        [1, 1],
          quality:       0.8,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Brak uprawnień', 'Zezwól na dostęp do galerii.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes:    ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect:        [1, 1],
          quality:       0.8,
        });
      }

      if (!result.canceled && result.assets?.[0]?.uri) {
        onCameraPress?.(result.assets[0].uri);
      }
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie można otworzyć galerii');
    }
  };

  const handlePress = () => {
    if (!onCameraPress) return;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options:             ['Anuluj', 'Zrób zdjęcie', 'Wybierz z galerii'],
          cancelButtonIndex:   0,
        },
        idx => {
          if (idx === 1) openPicker(true);
          if (idx === 2) openPicker(false);
        },
      );
    } else {
      // Android – prosty Alert z opcjami
      Alert.alert('Zdjęcie profilowe', 'Wybierz źródło', [
        { text: 'Aparat',  onPress: () => openPicker(true)  },
        { text: 'Galeria', onPress: () => openPicker(false) },
        { text: 'Anuluj',  style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={styles.avatarContainer}>
      <View style={styles.avatarCircle}>
        {uploading ? (
          <ActivityIndicator color="#e33835" size="large" />
        ) : avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={styles.avatarImage}
            onError={() => {}} // cicho ignoruj broken image
          />
        ) : (
          <Text style={styles.avatarText}>{initials}</Text>
        )}
      </View>

      {!!onCameraPress && !uploading && (
        <TouchableOpacity style={styles.cameraBtn} onPress={handlePress}>
          <MaterialIcons name="photo-camera" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarContainer: { position: 'relative' },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#252525',
    borderWidth: 2, borderColor: '#e33835',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#e33835',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 10,
    overflow: 'hidden',
  },
  avatarImage:  { width: 80, height: 80 },
  avatarText:   { fontFamily: 'Orbitron', fontSize: 24, color: '#e33835' },
  cameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: '#e33835',
    padding: 6, borderRadius: 15,
    borderWidth: 2, borderColor: '#1a1a1a',
  },
});