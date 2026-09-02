import React, { memo, useEffect, useState } from 'react';
import { View, Image, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import Mapbox from '@rnmapbox/maps';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import { useTheme } from '../../contexts/ThemeContext';

interface UserCarMarkerProps {
  user:     User;
  distance: number;
  onPress:  () => void;
  imageUri: string | null;
}

const AvatarOrInitials = memo(({ avatar, name, color, size = 22 }: {
  avatar: string; name: string; color: string; size?: number;
}) => {
  const isUrl = avatar?.startsWith('http');
  if (isUrl) {
    return (
      <Image
        source={{ uri: avatar }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
    );
  }
  return (
    <Text style={{ color, fontSize: size * 0.55, fontWeight: '700' }}>
      {name?.slice(0, 2).toUpperCase() ?? '??'}
    </Text>
  );
});

const FallbackMarker = memo(({ user, distance }: { user: User; distance: number }) => {
  const { theme } = useTheme();
  const color       = user.isPremium ? '#FFD700' : user.isFriend ? '#4de926' : '#00bfff';
  const bgColor     = user.isPremium ? '#FFD70020' : user.isFriend ? '#4de92620' : '#00bfff20';
  const borderColor = user.isPremium ? '#FFD70045' : user.isFriend ? '#4de92645' : '#00bfff45';
  const frameItem = user.avatarFrameUrl
    ? {
        id: `live_${user.id}`,
        name: 'Live frame',
        category: 'avatar_frame' as const,
        assetUrl: user.avatarFrameUrl,
      }
    : null;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{
        backgroundColor: theme.mapLabelBg, borderRadius: 10,
        paddingHorizontal: 8, paddingVertical: 5, marginBottom: 3,
        borderWidth: 1, borderColor, minWidth: 72, alignItems: 'center',
      }}>
        <Text style={{
          color: theme.mapLabelText, fontSize: 12, fontFamily: 'Manrope_600SemiBold',
          letterSpacing: 0.3, textAlign: 'center',
        }} numberOfLines={1}>
          {user.name}
        </Text>
        <Text style={{
          color, fontSize: 12, fontFamily: 'Manrope_600SemiBold',
          textAlign: 'center', marginTop: 1,
        }}>
          {distance.toFixed(1)} km
        </Text>
      </View>
      <View style={{ position: 'relative' }}>
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: bgColor, borderWidth: user.isPremium ? 3 : 1.5, borderColor,
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          <AvatarOrInitials avatar={user.avatar ?? ''} name={user.name} color={color} size={22} />
        </View>
        <ShopAvatarDecoration item={frameItem} size={36} />
        {user.isPremium && (
          <View style={{
            position: 'absolute', top: -6, right: -6,
            backgroundColor: '#FFD700', borderRadius: 8,
            width: 16, height: 16,
            alignItems: 'center', justifyContent: 'center',
            zIndex: 10,
          }}>
            <MaterialIcons name="workspace-premium" size={10} color="#000" />
          </View>
        )}
      </View>
      <View style={{
        width: 0, height: 0,
        borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6,
        borderStyle: 'solid', borderLeftColor: 'transparent',
        borderRightColor: 'transparent', borderTopColor: user.isPremium ? '#FFD700' : color, marginTop: -1,
      }} />
    </View>
  );
});

function quantizeCoord(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function userCarMarkerPropsEqual(prev: UserCarMarkerProps, next: UserCarMarkerProps): boolean {
  if (prev.user.id !== next.user.id) return false;
  if (prev.imageUri !== next.imageUri) return false;
  if (prev.onPress !== next.onPress) return false;
  if (!prev.imageUri && !next.imageUri) {
    if (Math.abs(prev.distance - next.distance) >= 0.15) return false;
  }
  return (
    quantizeCoord(prev.user.latitude) === quantizeCoord(next.user.latitude)
    && quantizeCoord(prev.user.longitude) === quantizeCoord(next.user.longitude)
  );
}

export const UserCarMarker = memo(({
  user, distance, onPress, imageUri,
}: UserCarMarkerProps) => {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  if (!imageUri || imageFailed) {
    return (
      <Mapbox.MarkerView coordinate={[user.longitude, user.latitude]} anchor={{ x: 0.5, y: 1 }} allowOverlapWithPuck allowOverlap>
        <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
          <FallbackMarker user={user} distance={distance} />
        </TouchableOpacity>
      </Mapbox.MarkerView>
    );
  }

  return (
    <Mapbox.MarkerView coordinate={[user.longitude, user.latitude]} anchor={{ x: 0.5, y: 1 }} allowOverlapWithPuck allowOverlap>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Image
          source={{ uri: imageUri }}
          style={{ width: 80, height: 80 }}
          resizeMode="contain"
          onError={() => setImageFailed(true)}
        />
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
}, userCarMarkerPropsEqual);