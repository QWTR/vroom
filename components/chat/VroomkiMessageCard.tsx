import React from 'react';
import { View, TouchableOpacity, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';

export interface VroomkiMessageData {
  type: 'vroomki';
  vroomkiPostId: number;
  legacyCarId?: number | null;
  caption?: string;
  coverUrl?: string | null;
  authorUsername?: string;
  mediaType?: string;
}

interface Props {
  data: VroomkiMessageData;
  isMe: boolean;
}

export function VroomkiMessageCard({ data, isMe }: Props) {
  const { theme } = useTheme();
  const router = useRouter();
  const isVideo = data.mediaType === 'video';

  const open = () => {
    router.push({
      pathname: '/Community/vroomki',
      params: { vroomkiId: String(data.vroomkiPostId) },
    } as any);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={open}
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        marginBottom: 2,
        width: 220,
        backgroundColor: isMe ? '#c42e2b' : theme.surface3,
        borderColor: isMe ? '#e3383540' : theme.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, paddingBottom: 6 }}>
        <MaterialIcons name="smart-display" size={14} color={theme.primary} />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: isMe ? '#ffffff80' : theme.textDim, letterSpacing: 1, flex: 1 }}>
          VROOMKI
        </Text>
      </View>
      {data.coverUrl ? (
        <View style={{ marginHorizontal: 8, borderRadius: 8, overflow: 'hidden', height: 120, backgroundColor: '#111' }}>
          <Image source={{ uri: data.coverUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          {isVideo && (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#000000aa', borderRadius: 999, padding: 4 }}>
              <MaterialIcons name="play-arrow" size={16} color="#fff" />
            </View>
          )}
        </View>
      ) : (
        <View style={{ marginHorizontal: 8, height: 90, borderRadius: 8, backgroundColor: isMe ? '#00000040' : theme.bg, justifyContent: 'center', alignItems: 'center' }}>
          <MaterialIcons name="directions-car" size={32} color={theme.primary} />
        </View>
      )}
      {!!data.authorUsername && (
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: isMe ? '#ffffffcc' : theme.text, fontWeight: '700', marginHorizontal: 10, marginTop: 8 }} numberOfLines={1}>
          @{data.authorUsername}
        </Text>
      )}
      {!!data.caption && (
        <Text style={{ fontSize: 12, color: isMe ? '#ffffffb0' : theme.textDim, marginHorizontal: 10, marginTop: 4, marginBottom: 8 }} numberOfLines={2}>
          {data.caption}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.primary, margin: 8, marginTop: 4, borderRadius: 10, paddingVertical: 9 }}>
        <MaterialIcons name="smart-display" size={13} color={theme.onPrimary} />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.onPrimary, fontWeight: '700', letterSpacing: 0.5 }}>OBEJRZYJ</Text>
      </View>
    </TouchableOpacity>
  );
}
