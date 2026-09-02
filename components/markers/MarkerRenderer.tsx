import React, { useCallback, useEffect, useRef } from 'react';
import { View, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import ViewShot from 'react-native-view-shot';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import { useTheme } from '../../contexts/ThemeContext';

interface MarkerRendererProps {
  user:      User;
  distance:  number;
  onCapture: (uri: string) => void;
}

const CAPTURE_DELAYS_MS = [80, 400, 1200];

const MarkerRendererInner = ({ user, distance, onCapture }: MarkerRendererProps) => {
  const { theme } = useTheme();
  const shotRef = useRef<ViewShot>(null);
  const captureGenRef = useRef(0);
  const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const color       = user.isFriend ? '#4de926' : '#00bfff';
  const bgColor     = user.isFriend ? '#4de92622' : '#00bfff22';
  const borderColor = user.isPremium ? '#FFD700' : (user.isFriend ? '#4de92650' : '#00bfff50');
  const avatarUri   = normalizeMediaUri(user.avatar ?? null);
  const avatarFrameUri = normalizeMediaUri(user.avatarFrameUrl ?? null);
  const frameItem = avatarFrameUri
    ? {
        id: `live_${user.id}`,
        name: 'Live frame',
        category: 'avatar_frame' as const,
        assetUrl: avatarFrameUri,
      }
    : null;
  const isUrl       = !!avatarUri;

  const clearRetryTimers = useCallback(() => {
    retryTimersRef.current.forEach((t) => clearTimeout(t));
    retryTimersRef.current = [];
  }, []);

  const captureMarker = useCallback((delayMs = 0) => {
    const gen = captureGenRef.current;
    const timer = setTimeout(() => {
      shotRef.current?.capture?.()
        .then((uri) => {
          if (gen !== captureGenRef.current) return;
          if (!uri) return;
          onCapture(uri);
        })
        .catch(() => {});
    }, delayMs);
    retryTimersRef.current.push(timer);
  }, [onCapture]);

  const scheduleCaptureRetries = useCallback(() => {
    clearRetryTimers();
    CAPTURE_DELAYS_MS.forEach((ms) => captureMarker(ms));
  }, [clearRetryTimers, captureMarker]);

  useEffect(() => {
    captureGenRef.current += 1;
    scheduleCaptureRetries();
    return () => {
      captureGenRef.current += 1;
      clearRetryTimers();
    };
  }, [scheduleCaptureRetries, user.id, user.name, user.avatar, user.isFriend, user.isPremium, clearRetryTimers]);

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0,
      opacity: 0, zIndex: -999, pointerEvents: 'none',
    }}>
      <ViewShot
        ref={shotRef}
        options={{ format: 'png', quality: 1.0 }}
      >
        <View style={{
          alignItems: 'center', backgroundColor: 'transparent',
          paddingHorizontal: 2, paddingTop: 2,
        }}>

          <View style={{
            backgroundColor: theme.mapLabelBg, borderRadius: 10,
            paddingHorizontal: 10, paddingVertical: 6, marginBottom: 3,
            borderWidth: 1.5, borderColor, minWidth: 88, alignItems: 'center',
          }}>
            <Text numberOfLines={1} style={{
              color: theme.mapLabelText, fontSize: 12, fontWeight: '700',
              textAlign: 'center', letterSpacing: 0.3,
            }}>
              {user.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
              <View style={{
                width: 5, height: 5, borderRadius: 3,
                backgroundColor: user.status === 'Online' ? theme.online : theme.textDim,
              }} />
              <Text style={{
                color, fontSize: 12, fontWeight: '700',
                textAlign: 'center', letterSpacing: 0.5,
              }}>
                {distance.toFixed(1)} km
              </Text>
            </View>
          </View>

          <View style={{ position: 'relative' }}>
            <View style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: bgColor, justifyContent: 'center',
              alignItems: 'center', borderWidth: user.isPremium ? 3 : 1.5, borderColor, overflow: 'hidden',
            }}>
              {isUrl ? (
                <Image
                  source={{ uri: avatarUri! }}
                  style={{ width: 40, height: 40, borderRadius: 20 }}
                  resizeMode="cover"
                  onLoadEnd={() => captureMarker(60)}
                  onError={() => {
                    captureMarker(0);
                  }}
                />
              ) : (
                <Text style={{ color, fontSize: 14, fontWeight: '700' }}>
                  {user.name?.slice(0, 2).toUpperCase() ?? '??'}
                </Text>
              )}
            </View>
            <ShopAvatarDecoration item={frameItem} size={40} />
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
            borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7,
            borderStyle: 'solid', borderLeftColor: 'transparent',
            borderRightColor: 'transparent', borderTopColor: color, marginTop: -1,
          }} />
        </View>
      </ViewShot>
    </View>
  );
};

export const MarkerRenderer = React.memo(
  MarkerRendererInner,
  (prev, next) =>
    prev.user.id === next.user.id
    && prev.user.name === next.user.name
    && prev.user.avatar === next.user.avatar
    && prev.user.avatarFrameUrl === next.user.avatarFrameUrl
    && prev.user.isFriend === next.user.isFriend
    && prev.user.isPremium === next.user.isPremium,
);
