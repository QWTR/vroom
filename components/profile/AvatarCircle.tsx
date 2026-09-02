import React from 'react';
import { View, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  initials:       string;
  avatarUrl?:     string | null;
  uploading?:     boolean;
  onCameraPress?: () => void;
}

export default function AvatarCircle({ initials, avatarUrl, uploading = false, onCameraPress }: Props) {
  const { theme } = useTheme();
  return (
    <View style={{ position: 'relative' }}>
      <View style={{
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: theme.surface3, borderWidth: 2, borderColor: theme.primary,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: theme.primary, shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5, shadowRadius: 10, overflow: 'hidden',
      }}>
        {uploading ? (
          <ActivityIndicator color={theme.primary} size="large" />
        ) : avatarUrl ? (
          <Image key={avatarUrl} source={{ uri: avatarUrl }} style={{ width: 80, height: 80 }} />
        ) : (
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 24, color: theme.primary }}>{initials}</Text>
        )}
      </View>
      {!!onCameraPress && !uploading && (
        <TouchableOpacity
          style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: theme.primary, padding: 6, borderRadius: 15, borderWidth: 2, borderColor: theme.surface3 }}
          onPress={onCameraPress}
        >
          <MaterialIcons name="photo-camera" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}
