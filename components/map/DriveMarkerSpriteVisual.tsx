import React, { memo, useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { normalizeMediaUri } from '../../lib/mediaUri';

export const DRIVE_MARKER_SPRITE_SIZE = 64;
const AVATAR_INNER = 54;
const MARKER_BORDER = 3;
const FALLBACK_DOT = 58;

export type DriveMarkerSpriteData = {
  avatarUrl?: string | null;
  imageUri?: string | null;
  cursorSkin?: { imageUrl?: string; borderColor?: string } | null;
};

type Props = {
  data: DriveMarkerSpriteData;
  onReady: () => void;
};

/**
 * Statyczny widok markera do ViewShot (bez obrotu — SymbolLayer robi iconRotate).
 * Priorytet: skin > avatar > snapshot car/arrow > fallback dot.
 */
export const DriveMarkerSpriteVisual = memo(function DriveMarkerSpriteVisual({
  data,
  onReady,
}: Props) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [snapshotFailed, setSnapshotFailed] = useState(false);

  const mediaAvatar = normalizeMediaUri(data.avatarUrl);
  const skinUri = normalizeMediaUri(data.cursorSkin?.imageUrl);
  const skinBorder = data.cursorSkin?.borderColor ?? '#e33835';
  const snapshotUri = data.imageUri ?? null;

  const showSkin = !!skinUri;
  const showAvatar = !!mediaAvatar && !avatarFailed && !showSkin;
  const showSnapshot = !!snapshotUri && !snapshotFailed && !showAvatar && !showSkin;

  const signalReady = useCallback(() => {
    onReady();
  }, [onReady]);

  useEffect(() => {
    setAvatarFailed(false);
    setSnapshotFailed(false);
  }, [data.avatarUrl, data.imageUri, data.cursorSkin?.imageUrl]);

  useEffect(() => {
    if (showSkin || showAvatar || showSnapshot) return;
    signalReady();
  }, [showSkin, showAvatar, showSnapshot, signalReady]);

  const box = DRIVE_MARKER_SPRITE_SIZE;

  if (showSkin) {
    return (
      <View
        style={{
          width: box,
          height: box,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        }}
      >
        <View
          style={{
            width: box,
            height: box,
            borderRadius: box / 2,
            backgroundColor: '#111',
            borderWidth: MARKER_BORDER + 1,
            borderColor: skinBorder,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image
            source={{ uri: skinUri }}
            style={{ width: AVATAR_INNER, height: AVATAR_INNER }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            onLoad={signalReady}
            onError={signalReady}
          />
        </View>
      </View>
    );
  }

  if (showAvatar) {
    return (
      <View
        style={{
          width: box,
          height: box,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        }}
      >
        <View
          style={{
            width: box,
            height: box,
            borderRadius: box / 2,
            backgroundColor: '#111',
            borderWidth: MARKER_BORDER,
            borderColor: '#ffffff',
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image
            source={{ uri: mediaAvatar }}
            style={{ width: AVATAR_INNER, height: AVATAR_INNER, borderRadius: AVATAR_INNER / 2 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
            onLoad={signalReady}
            onError={() => {
              setAvatarFailed(true);
              signalReady();
            }}
          />
        </View>
      </View>
    );
  }

  if (showSnapshot) {
    return (
      <View
        style={{
          width: box,
          height: box,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        }}
      >
        <Image
          source={{ uri: snapshotUri }}
          style={{ width: box, height: box }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          onLoad={signalReady}
          onError={() => {
            setSnapshotFailed(true);
            signalReady();
          }}
        />
      </View>
    );
  }

  return (
    <View
      style={{
        width: box,
        height: box,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
      }}
    >
      <View
        style={{
          width: FALLBACK_DOT,
          height: FALLBACK_DOT,
          borderRadius: FALLBACK_DOT / 2,
          backgroundColor: '#e33835',
          borderWidth: 3,
          borderColor: '#fff',
        }}
      />
    </View>
  );
});
