import React, { useRef, useEffect, useCallback } from 'react';
import { View, Text, Image } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { normalizeMediaUri } from '../../lib/mediaUri';

interface CarMarkerRendererProps {
  avatarUrl: string | null;
  username:  string;
  onCapture: (uri: string) => void;
}

const CAPTURE_FALLBACK_MS = 800;

export const CarMarkerRenderer = ({ avatarUrl, username, onCapture }: CarMarkerRendererProps) => {
  const shotRef       = useRef<ViewShot>(null);
  const capturedRef   = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaUri      = normalizeMediaUri(avatarUrl);
  const initials      = username?.slice(0, 2).toUpperCase() ?? '??';

  const captureMarker = useCallback((delayMs = 0) => {
    if (capturedRef.current) return;
    setTimeout(() => {
      shotRef.current?.capture?.()
        .then((uri) => {
          if (!uri) return;
          capturedRef.current = true;
          onCapture(uri);
        })
        .catch(() => {});
    }, delayMs);
  }, [onCapture]);

  useEffect(() => {
    capturedRef.current = false;
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);

    if (!mediaUri) {
      captureMarker(80);
      return;
    }

    fallbackTimer.current = setTimeout(() => {
      if (!capturedRef.current) captureMarker(0);
    }, CAPTURE_FALLBACK_MS);

    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, [mediaUri, username, captureMarker]);

  const onAvatarLoaded = useCallback(() => {
    if (fallbackTimer.current) {
      clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
    captureMarker(40);
  }, [captureMarker]);

  return (
    <View style={{
      position: 'absolute',
      top: 0,
      left: -10_000,
      width: 60,
      height: 60,
      opacity: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
    }}>
      <ViewShot
        ref={shotRef}
        options={{ format: 'png', quality: 1.0 }}
      >
        <View style={{
          width: 60,
          height: 60,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        }}>
          <View style={{
            width: 50,
            height: 50,
            borderRadius: 24,
            backgroundColor: '#111111',
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 2.5,
            borderColor: '#e33835',
            overflow: 'hidden',
          }}>
            <View style={{
              position: 'absolute',
              width: 50,
              height: 50,
              borderRadius: 19,
              borderWidth: 1,
              borderColor: '#e3383540',
              zIndex: 1,
            }} />
            {mediaUri ? (
              <Image
                source={{ uri: mediaUri }}
                style={{ width: 50, height: 50, borderRadius: 24 }}
                resizeMode="cover"
                onLoadEnd={onAvatarLoaded}
                onError={() => captureMarker(0)}
              />
            ) : (
              <Text style={{
                color: '#e33835',
                fontSize: 16,
                fontWeight: '700',
                letterSpacing: 0.5,
              }}>
                {initials}
              </Text>
            )}
          </View>
        </View>
      </ViewShot>
    </View>
  );
};
