import React, { memo, useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialIcons } from '@expo/vector-icons';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import { useTheme } from '../../contexts/ThemeContext';
import type { LiveMapStore } from '../../hooks/liveMapStore';
import { useLiveUserMeta, useLiveUserPosition } from '../../hooks/liveMapStore';

type Props = {
  userId: number;
  store: LiveMapStore;
  imageUri: string | null;
  distanceKm: number;
  onPress: () => void;
};

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

const FallbackBody = memo(({
  name,
  avatar,
  avatarFrameUrl,
  isFriend,
  isPremium,
  distanceKm,
}: {
  name: string;
  avatar: string;
  avatarFrameUrl?: string | null;
  isFriend: boolean;
  isPremium: boolean;
  distanceKm: number;
}) => {
  const { theme } = useTheme();
  const color = isPremium ? '#FFD700' : isFriend ? '#4de926' : '#00bfff';
  const bgColor = isPremium ? '#FFD70020' : isFriend ? '#4de92620' : '#00bfff20';
  const borderColor = isPremium ? '#FFD70045' : isFriend ? '#4de92645' : '#00bfff45';
  const frameItem = avatarFrameUrl
    ? {
        id: 'live_frame',
        name: 'Live frame',
        category: 'avatar_frame' as const,
        assetUrl: avatarFrameUrl,
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
          color: theme.mapLabelText, fontSize: 9, fontFamily: 'Orbitron',
          letterSpacing: 0.3, textAlign: 'center',
        }} numberOfLines={1}>
          {name}
        </Text>
        <Text style={{
          color, fontSize: 8, fontFamily: 'Orbitron',
          textAlign: 'center', marginTop: 1,
        }}>
          {distanceKm.toFixed(1)} km
        </Text>
      </View>
      <View style={{ position: 'relative' }}>
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: bgColor, borderWidth: isPremium ? 3 : 1.5, borderColor,
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          <AvatarOrInitials avatar={avatar} name={name} color={color} size={22} />
        </View>
        <ShopAvatarDecoration item={frameItem} size={36} />
        {isPremium && (
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
        borderRightColor: 'transparent', borderTopColor: isPremium ? '#FFD700' : color, marginTop: -1,
      }} />
    </View>
  );
});

function quantizeCoord(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function LiveUserMarkerInner({
  userId, store, imageUri, distanceKm, onPress,
}: Props) {
  const meta = useLiveUserMeta(store, userId);
  const position = useLiveUserPosition(store, userId);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  if (!meta || !position) return null;
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;

  const coordinate: [number, number] = [
    quantizeCoord(position.lng),
    quantizeCoord(position.lat),
  ];

  if (!imageUri || imageFailed) {
    return (
      <Mapbox.MarkerView coordinate={coordinate} anchor={{ x: 0.5, y: 1 }} allowOverlapWithPuck allowOverlap>
        <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
          <FallbackBody
            name={meta.username}
            avatar={meta.avatarUrl ?? ''}
            avatarFrameUrl={meta.avatarFrameUrl}
            isFriend={!!meta.isFriend}
            isPremium={!!meta.isPremium}
            distanceKm={distanceKm}
          />
        </TouchableOpacity>
      </Mapbox.MarkerView>
    );
  }

  return (
    <Mapbox.MarkerView coordinate={coordinate} anchor={{ x: 0.5, y: 1 }} allowOverlapWithPuck allowOverlap>
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
}

export const LiveUserMarker = memo(LiveUserMarkerInner, (prev, next) => (
  prev.userId === next.userId
  && prev.store === next.store
  && prev.imageUri === next.imageUri
  && Math.abs(prev.distanceKm - next.distanceKm) < 0.15
  && prev.onPress === next.onPress
));
