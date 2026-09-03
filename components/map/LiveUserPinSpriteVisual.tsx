import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { normalizeMediaUri } from '../../lib/mediaUri';
import {
  LIVE_USER_PIN_SPRITE_H,
  LIVE_USER_PIN_SPRITE_W,
} from '../../hooks/useLiveUserPinSprites';
import type { PremiumVisual } from '../user/PremiumIdentity';

const AVATAR_SIZE = 40;
const RING_SIZE = 46;

export type LiveUserPinSpriteData = {
  username: string;
  initials: string;
  distanceLabel: string;
  avatarUrl: string | null;
  avatarFrameUrl: string | null;
  isPremium: boolean;
  premiumVisual?: PremiumVisual | null;
  isFriend: boolean;
  stale?: boolean;
};

function pinAccent(data: LiveUserPinSpriteData) {
  if (data.isPremium) return data.premiumVisual?.accentColors?.[0] ?? '#FFD700';
  if (data.isFriend) return '#4de926';
  return '#00bfff';
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
  const [avatarError, setAvatarError] = useState(false);

  const accent = data.stale ? '#747b86' : pinAccent(data);
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

  return (
    <View
      style={{
        width: LIVE_USER_PIN_SPRITE_W,
        height: LIVE_USER_PIN_SPRITE_H,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: 'rgba(7, 10, 15, 0.72)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            borderRadius: RING_SIZE / 2,
            borderWidth: data.isPremium ? 3 : 2,
            borderColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#11151b',
          }}
        >
          <View
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: AVATAR_SIZE / 2,
              overflow: 'hidden',
              backgroundColor: '#3d434c',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: data.stale ? 0.62 : 1,
            }}
          >
            <Text
              style={{
                color: '#ffffff',
                fontSize: 14,
                fontWeight: '800',
                textAlign: 'center',
              }}
            >
              {data.initials}
            </Text>
            {showAvatar ? (
              <Image
                source={{ uri: avatarUri! }}
                style={{ position: 'absolute', width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: avatarBg }}
                resizeMode="cover"
                onLoad={handleAvatarLoad}
                onError={handleAvatarError}
              />
            ) : null}
          </View>
        </View>
        <View
          style={{
            position: 'absolute',
            right: 2,
            bottom: 5,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: data.stale ? '#777d86' : '#38e54d',
            borderWidth: 2,
            borderColor: '#0b0e13',
          }}
        />
      </View>
    </View>
  );
});
