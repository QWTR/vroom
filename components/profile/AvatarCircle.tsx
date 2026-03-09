import React from 'react';
import {
  View, Image, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

interface Props {
  initials:       string;
  avatarUrl?:     string | null;
  uploading?:     boolean;
  onCameraPress?: () => void;
}

export default function AvatarCircle({
  initials, avatarUrl, uploading = false, onCameraPress,
}: Props) {
  return (
    <View style={styles.avatarContainer}>
      <View style={styles.avatarCircle}>
        {uploading ? (
          <ActivityIndicator color="#e33835" size="large" />
        ) : avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>{initials}</Text>
        )}
      </View>
      {!!onCameraPress && !uploading && (
        <TouchableOpacity style={styles.cameraBtn} onPress={onCameraPress}>
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
    backgroundColor: '#252525', borderWidth: 2, borderColor: '#e33835',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#e33835', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 10, overflow: 'hidden',
  },
  avatarImage: { width: 80, height: 80 },
  avatarText:  { fontFamily: 'Orbitron', fontSize: 24, color: '#e33835' },
  cameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: '#e33835', padding: 6, borderRadius: 15,
    borderWidth: 2, borderColor: '#1a1a1a',
  },
});