import React, { memo } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';

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
  const color       = user.isFriend ? '#4de926' : '#00bfff';
  const bgColor     = user.isFriend ? '#4de92620' : '#00bfff20';
  const borderColor = user.isPremium ? '#FFD700' : (user.isFriend ? '#4de92645' : '#00bfff45');

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{
        backgroundColor: '#111111ee', borderRadius: 10,
        paddingHorizontal: 8, paddingVertical: 5, marginBottom: 3,
        borderWidth: 1, borderColor, minWidth: 72, alignItems: 'center',
      }}>
        <Text style={{
          color: '#fff', fontSize: 9, fontFamily: 'Orbitron',
          letterSpacing: 0.3, textAlign: 'center',
        }} numberOfLines={1}>
          {user.name}
        </Text>
        <Text style={{
          color, fontSize: 8, fontFamily: 'Orbitron',
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
        borderRightColor: 'transparent', borderTopColor: borderColor, marginTop: -1,
      }} />
    </View>
  );
});

export const UserCarMarker = memo(({
  user, distance, onPress, imageUri,
}: UserCarMarkerProps) => {
  if (!imageUri) {
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
        <Image source={{ uri: imageUri }} style={{ width: 80, height: 80 }} resizeMode="contain" />
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});