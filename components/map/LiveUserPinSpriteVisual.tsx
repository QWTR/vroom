import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { normalizeMediaUri } from '../../lib/mediaUri';
import {
  LIVE_USER_PIN_SPRITE_H,
  LIVE_USER_PIN_SPRITE_W,
} from '../../hooks/useLiveUserPinSprites';
import type { PremiumVisual } from '../user/PremiumIdentity';

const CARD_WIDTH = 132;
const CARD_HEIGHT = 48;
const AVATAR_SIZE = 38;
const MAX_USERNAME_LENGTH = 14;

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

export function formatLiveUserMarkerName(username: string): string {
  const normalized = username.trim() || 'Użytkownik';
  if (normalized.length <= MAX_USERNAME_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_USERNAME_LENGTH - 1).trimEnd()}…`;
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
  const markerName = formatLiveUserMarkerName(data.username);

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
    <View style={styles.canvas}>
      <View
        style={[
          styles.card,
          {
            borderColor: accent,
            opacity: data.stale ? 0.78 : 1,
          },
        ]}
      >
        <View style={styles.avatarSlot}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: avatarBg,
                opacity: data.stale ? 0.68 : 1,
              },
            ]}
          >
            <Text style={styles.initials}>
              {data.initials}
            </Text>
            {showAvatar ? (
              <Image
                source={{ uri: avatarUri! }}
                style={[styles.avatarImage, { backgroundColor: avatarBg }]}
                resizeMode="cover"
                onLoad={handleAvatarLoad}
                onError={handleAvatarError}
              />
            ) : null}
          </View>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: data.stale ? '#777d86' : '#38e54d' },
            ]}
          />
        </View>
        <Text numberOfLines={1} style={styles.username}>
          {markerName}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  canvas: {
    width: LIVE_USER_PIN_SPRITE_W,
    height: LIVE_USER_PIN_SPRITE_H,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginTop: 2,
    borderRadius: 24,
    borderWidth: 1.5,
    backgroundColor: '#090D13',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 10,
  },
  avatarSlot: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    position: 'absolute',
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  initials: {
    color: '#F7FAFF',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusDot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#090D13',
  },
  username: {
    flex: 1,
    color: '#F7FAFF',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
});
