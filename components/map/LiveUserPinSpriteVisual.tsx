import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { normalizeMediaUri } from '../../lib/mediaUri';
import {
  LIVE_USER_PIN_SPRITE_H,
  LIVE_USER_PIN_SPRITE_W,
} from '../../hooks/useLiveUserPinSprites';

const AVATAR_SIZE = 40;
const FRAME_SIZE = 46;

export type LiveUserPinSpriteData = {
  username: string;
  initials: string;
  distanceLabel: string;
  avatarUrl: string | null;
  avatarFrameUrl: string | null;
  isPremium: boolean;
  isFriend: boolean;
  stale?: boolean;
};

function pinAccent(data: LiveUserPinSpriteData) {
  if (data.isPremium) return '#FFD700';
  if (data.isFriend) return '#4de926';
  return '#00bfff';
}

function pinBorderColor(data: LiveUserPinSpriteData) {
  if (data.isPremium) return '#FFD700';
  if (data.isFriend) return '#4de92650';
  return '#00bfff50';
}

function pinAvatarBg(data: LiveUserPinSpriteData) {
  if (data.isPremium) return '#FFD70020';
  if (data.isFriend) return '#4de92622';
  return '#00bfff22';
}

export const LiveUserPinSpriteVisual = memo(function LiveUserPinSpriteVisual({
  data,
  onReady,
}: {
  data: LiveUserPinSpriteData;
  onReady?: (final: boolean) => void;
}) {
  const avatarUri = normalizeMediaUri(data.avatarUrl);
  const frameUri = normalizeMediaUri(data.avatarFrameUrl);
  const [avatarError, setAvatarError] = useState(false);

  const accent = pinAccent(data);
  const borderColor = pinBorderColor(data);
  const avatarBg = pinAvatarBg(data);
  const showAvatar = !!avatarUri && !avatarError;

  const notifyReady = useCallback((final: boolean) => {
    onReady?.(final);
  }, [onReady]);

  useEffect(() => {
    setAvatarError(false);
  }, [avatarUri]);

  useEffect(() => {
    if (!avatarUri) {
      notifyReady(true);
      return;
    }
    // First capture is the initials fallback; keep the capture mounted so the
    // loaded avatar can replace it without ever leaving the map marker-less.
    notifyReady(false);
    const timer = setTimeout(() => {
      notifyReady(true);
    }, 1_200);
    return () => clearTimeout(timer);
  }, [avatarUri, notifyReady]);

  const handleAvatarLoad = useCallback(() => {
    notifyReady(true);
  }, [notifyReady]);

  const handleAvatarError = useCallback(() => {
    setAvatarError(true);
    notifyReady(true);
  }, [notifyReady]);

  const avatarBorderStyle = data.isPremium
    ? { borderWidth: 3, borderColor: '#FFD700' as const }
    : { borderWidth: 1.5, borderColor: borderColor as string };

  return (
    <View
      style={{
        width: LIVE_USER_PIN_SPRITE_W,
        height: LIVE_USER_PIN_SPRITE_H,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'flex-end',
        overflow: 'hidden',
      }}
    >
      <View style={{ alignItems: 'center', paddingHorizontal: 4, paddingBottom: 1 }}>
        {/* Pigułka: nazwa + online + dystans */}
        <View
          style={{
            backgroundColor: 'rgba(17, 17, 17, 0.9)',
            borderRadius: 12,
            paddingHorizontal: 10,
            paddingVertical: 6,
            marginBottom: 4,
            borderWidth: 1.5,
            borderColor,
            minWidth: 88,
            maxWidth: LIVE_USER_PIN_SPRITE_W - 8,
            alignItems: 'center',
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: '#ffffff',
              fontSize: 10,
              fontWeight: '700',
              textAlign: 'center',
              letterSpacing: 0.3,
            }}
          >
            {data.username}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginTop: 3,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: data.stale ? '#888888' : '#4de926',
              }}
            />
            <Text
              style={{
                color: accent,
                fontSize: 8,
                fontWeight: '700',
                textAlign: 'center',
                letterSpacing: 0.5,
              }}
            >
              {data.distanceLabel}
            </Text>
          </View>
        </View>

        {/* Łącznik pigułka → awatar */}
        <View
          style={{
            width: 2,
            height: 5,
            backgroundColor: accent,
            opacity: 0.55,
            borderRadius: 1,
            marginBottom: 2,
          }}
        />

        {/* Awatar */}
        <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
          {frameUri ? (
            <ExpoImage
              source={{ uri: frameUri }}
              style={{
                position: 'absolute',
                width: FRAME_SIZE,
                height: FRAME_SIZE,
                top: (AVATAR_SIZE - FRAME_SIZE) / 2,
                left: (AVATAR_SIZE - FRAME_SIZE) / 2,
              }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : null}

          <View
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: 9999,
              overflow: 'hidden',
              backgroundColor: '#3d3d3d',
              alignItems: 'center',
              justifyContent: 'center',
              ...avatarBorderStyle,
            }}
          >
            <Text
              style={{
                color: '#ffffff',
                fontSize: 14,
                fontWeight: '800',
                letterSpacing: 0.5,
                textAlign: 'center',
              }}
            >
              {data.initials}
            </Text>
            {showAvatar ? (
              <Image
                source={{ uri: avatarUri! }}
                style={{
                  position: 'absolute',
                  width: AVATAR_SIZE,
                  height: AVATAR_SIZE,
                  borderRadius: 9999,
                  backgroundColor: avatarBg,
                }}
                resizeMode="cover"
                onLoad={handleAvatarLoad}
                onError={handleAvatarError}
              />
            ) : null}
          </View>

          {data.isPremium ? (
            <View
              style={{
                position: 'absolute',
                top: -5,
                right: -5,
                backgroundColor: '#FFD700',
                borderRadius: 8,
                width: 15,
                height: 15,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                borderWidth: 1,
                borderColor: '#00000030',
              }}
            >
              <MaterialIcons name="workspace-premium" size={9} color="#000" />
            </View>
          ) : null}
        </View>

        {/* Grot pinu */}
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 6,
            borderRightWidth: 6,
            borderTopWidth: 7,
            borderStyle: 'solid',
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: accent,
            marginTop: 1,
          }}
        />
      </View>
    </View>
  );
});
