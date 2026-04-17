import React, { useRef, useEffect } from 'react';
import { View, Text, Image } from 'react-native';
import ViewShot from 'react-native-view-shot';

interface CarMarkerRendererProps {
  avatarUrl: string | null;
  username:  string;
  onCapture: (uri: string) => void;
  // heading usunięty
}

export const CarMarkerRenderer = ({ avatarUrl, username, onCapture }: CarMarkerRendererProps) => {
  const shotRef  = useRef<ViewShot>(null);
  const isUrl    = avatarUrl?.startsWith('http');
  const initials = username?.slice(0, 2).toUpperCase() ?? '??';

  useEffect(() => {
    const timer = setTimeout(() => {
      shotRef.current?.capture?.().then(onCapture).catch(() => {});
    }, 50);
    return () => clearTimeout(timer);
  }, [avatarUrl, username]); // ← heading usunięty z deps

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
            {isUrl ? (
              <Image
                source={{ uri: avatarUrl! }}
                style={{ width: 50, height: 50, borderRadius: 24 }}
                resizeMode="cover"
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