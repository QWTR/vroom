import React, { memo, useCallback, useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image as ExpoImage } from 'expo-image';
import { normalizeMediaUri } from '../../lib/mediaUri';
import type { LiveUserPinSpriteData } from './LiveUserPinSpriteVisual';

const COMPACT_W = 56;
const COMPACT_H = 56;
const AVATAR = 44;

type Props = {
  imageKey: string;
  data: LiveUserPinSpriteData;
  onCapture: (imageKey: string, uri: string) => void;
};

async function normalizeSpriteUri(rawUri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    rawUri,
    [{ resize: { width: COMPACT_W, height: COMPACT_H } }],
    { format: ImageManipulator.SaveFormat.PNG, compress: 0.9 },
  );
  return out.uri;
}

export const LiveUserPinCompactSpriteCapture = memo(function LiveUserPinCompactSpriteCapture({
  imageKey,
  data,
  onCapture,
}: Props) {
  const shotRef = useRef<ViewShot>(null);
  const genRef = useRef(0);
  const busyRef = useRef(false);
  const avatarUri = normalizeMediaUri(data.avatarUrl);
  const borderColor = data.isPremium ? '#FFD700' : data.isFriend ? '#4de926' : '#00bfff';

  const captureNow = useCallback(() => {
    const gen = genRef.current;
    if (busyRef.current) return;
    busyRef.current = true;
    shotRef.current?.capture?.()
      .then(async (uri) => {
        if (gen !== genRef.current || !uri) return;
        try {
          const normalized = await normalizeSpriteUri(uri);
          if (gen !== genRef.current) return;
          onCapture(imageKey, normalized);
        } catch {
          onCapture(imageKey, uri);
        }
      })
      .catch(() => {})
      .finally(() => {
        busyRef.current = false;
      });
  }, [imageKey, onCapture]);

  useEffect(() => {
    genRef.current += 1;
    busyRef.current = false;
    const timer = setTimeout(captureNow, 60);
    return () => {
      genRef.current += 1;
      clearTimeout(timer);
    };
  }, [captureNow, data.initials, data.avatarUrl, data.isPremium, data.isFriend]);

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: COMPACT_W,
        height: COMPACT_H,
        opacity: 1,
        pointerEvents: 'none',
      }}
    >
      <ViewShot
        ref={shotRef}
        options={{ format: 'png', quality: 1, width: COMPACT_W, height: COMPACT_H }}
      >
        <View
          style={{
            width: COMPACT_W,
            height: COMPACT_H,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'transparent',
          }}
        >
          <View
            style={{
              width: AVATAR,
              height: AVATAR,
              borderRadius: AVATAR / 2,
              overflow: 'hidden',
              borderWidth: data.isPremium ? 3 : 2,
              borderColor,
              backgroundColor: '#3d3d3d',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatarUri ? (
              <ExpoImage
                source={{ uri: avatarUri }}
                style={{ width: AVATAR, height: AVATAR }}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{data.initials}</Text>
            )}
          </View>
        </View>
      </ViewShot>
    </View>
  );
});
