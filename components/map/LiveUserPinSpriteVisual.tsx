import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { normalizeMediaUri } from '../../lib/mediaUri';
import {
  LIVE_USER_PIN_SPRITE_H,
  LIVE_USER_PIN_SPRITE_W,
} from '../../hooks/useLiveUserPinSprites';
import type { PremiumVisual } from '../user/PremiumIdentity';

const CARD_WIDTH = 156;
const CARD_HEIGHT = 56;
const AVATAR_SIZE = 44;
const AVATAR_RING_SIZE = 48;
const AVATAR_FRAME_SIZE = 56;
const MAX_USERNAME_LENGTH = 15;
const ASSET_SETTLE_TIMEOUT_MS = 1_800;

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

function pinAccentColors(data: LiveUserPinSpriteData): [string, string] {
  if (data.isPremium) {
    const colors = data.premiumVisual?.accentColors;
    if (Array.isArray(colors) && colors.length === 2) return colors;
    return ['#FFD447', '#F59E0B'];
  }
  if (data.isFriend) return ['#4DE926', '#21B93B'];
  return ['#445064', '#2C3442'];
}

function pinAvatarBg(data: LiveUserPinSpriteData) {
  if (data.isPremium) return '#FFD44720';
  if (data.isFriend) return '#4DE92620';
  return '#232A35';
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
  const frameUri = normalizeMediaUri(data.avatarFrameUrl);
  const [avatarError, setAvatarError] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [avatarSettled, setAvatarSettled] = useState(!avatarUri);
  const [frameSettled, setFrameSettled] = useState(!frameUri);

  const accents = data.stale ? ['#747B86', '#555D68'] as [string, string] : pinAccentColors(data);
  const avatarBg = pinAvatarBg(data);
  const showAvatar = !!avatarUri && !avatarError;
  const showFrame = !!frameUri && !frameError;
  const markerName = formatLiveUserMarkerName(data.username);
  const usernameColor = data.isPremium
    ? (data.premiumVisual?.nickColor ?? accents[0])
    : '#F7FAFF';

  const notifyReady = useCallback((final: boolean) => {
    onReady?.(final);
  }, [onReady]);

  useEffect(() => {
    if (avatarSettled && frameSettled) {
      notifyReady(true);
      return;
    }

    // Najpierw publikujemy kompletny fallback z inicjałami. Capture pozostaje
    // zamontowany, dopóki avatar i ramka nie zakończą ładowania.
    notifyReady(false);
    const timer = setTimeout(() => {
      if (!avatarSettled) {
        setAvatarError(true);
        setAvatarSettled(true);
      }
      if (!frameSettled) {
        setFrameError(true);
        setFrameSettled(true);
      }
    }, ASSET_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [avatarSettled, frameSettled, notifyReady]);

  const handleAvatarLoad = useCallback(() => {
    setAvatarSettled(true);
  }, []);

  const handleAvatarError = useCallback(() => {
    setAvatarError(true);
    setAvatarSettled(true);
  }, []);

  const handleFrameLoad = useCallback(() => {
    setFrameSettled(true);
  }, []);

  const handleFrameError = useCallback(() => {
    setFrameError(true);
    setFrameSettled(true);
  }, []);

  return (
    <View style={styles.canvas}>
      <LinearGradient
        colors={accents}
        start={data.premiumVisual?.ringGradient?.start ?? { x: 0, y: 0 }}
        end={data.premiumVisual?.ringGradient?.end ?? { x: 1, y: 1 }}
        style={[
          styles.cardBorder,
          { opacity: data.stale ? 0.76 : 1 },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.avatarSlot}>
            <LinearGradient
              colors={accents}
              start={data.premiumVisual?.ringGradient?.start ?? { x: 0, y: 0 }}
              end={data.premiumVisual?.ringGradient?.end ?? { x: 1, y: 1 }}
              style={styles.avatarRing}
            >
              <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
                <Text style={styles.initials}>
                  {data.initials}
                </Text>
                {showAvatar ? (
                  <Image
                    source={{ uri: avatarUri! }}
                    style={[styles.avatarImage, { backgroundColor: avatarBg }]}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={0}
                    onLoad={handleAvatarLoad}
                    onError={handleAvatarError}
                  />
                ) : null}
              </View>
            </LinearGradient>
            {showFrame ? (
              <Image
                source={{ uri: frameUri! }}
                style={styles.avatarFrame}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
                onLoad={handleFrameLoad}
                onError={handleFrameError}
              />
            ) : null}
            <View
              style={[
                styles.statusDot,
                { backgroundColor: data.stale ? '#777D86' : '#38E54D' },
              ]}
            />
          </View>
          <View style={styles.identity}>
            <View style={styles.nameRow}>
              <Text
                numberOfLines={1}
                style={[styles.username, { color: usernameColor }]}
              >
                {markerName}
              </Text>
              {data.isPremium ? (
                <View style={[styles.premiumBadge, { backgroundColor: accents[0] }]}>
                  <MaterialIcons name="workspace-premium" size={10} color="#080A0E" />
                </View>
              ) : null}
            </View>
            <View style={styles.liveRow}>
              <View style={[styles.liveDot, { backgroundColor: data.stale ? '#777D86' : '#38E54D' }]} />
              <Text style={[styles.liveText, data.stale && styles.staleText]}>
                {data.stale ? 'OSTATNIO' : 'LIVE'}
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  canvas: {
    width: LIVE_USER_PIN_SPRITE_W,
    height: LIVE_USER_PIN_SPRITE_H,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardBorder: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: CARD_HEIGHT / 2,
    padding: 1.5,
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  card: {
    flex: 1,
    borderRadius: CARD_HEIGHT / 2,
    backgroundColor: '#080B10F5',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 3,
    paddingRight: 9,
  },
  avatarSlot: {
    width: AVATAR_FRAME_SIZE,
    height: AVATAR_FRAME_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -2,
    marginRight: 3,
  },
  avatarRing: {
    width: AVATAR_RING_SIZE,
    height: AVATAR_RING_SIZE,
    borderRadius: AVATAR_RING_SIZE / 2,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
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
  avatarFrame: {
    position: 'absolute',
    width: AVATAR_FRAME_SIZE,
    height: AVATAR_FRAME_SIZE,
    zIndex: 4,
  },
  initials: {
    color: '#F7FAFF',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusDot: {
    position: 'absolute',
    right: 2,
    bottom: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#080B10',
    zIndex: 6,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 4,
  },
  username: {
    flex: 1,
    fontFamily: 'Manrope_700Bold',
    fontSize: 13.5,
    lineHeight: 17.5,
    fontWeight: '800',
    textShadowColor: '#000000CC',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  premiumBadge: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    color: '#38E54D',
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  staleText: {
    color: '#89919D',
  },
});
