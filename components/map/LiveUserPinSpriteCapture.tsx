import React, { memo, useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  LIVE_USER_PIN_SPRITE_H,
  LIVE_USER_PIN_SPRITE_W,
} from '../../hooks/useLiveUserPinSprites';
import {
  LiveUserPinSpriteVisual,
  type LiveUserPinSpriteData,
} from './LiveUserPinSpriteVisual';

/** Krótki bufor po sygnale gotowości — layout + paint przed ViewShot. */
const READY_CAPTURE_DELAY_MS = 80;

type Props = {
  imageKey: string;
  data: LiveUserPinSpriteData;
  onCapture: (imageKey: string, uri: string) => void;
};

async function normalizeSpriteUri(rawUri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    rawUri,
    [{ resize: { width: LIVE_USER_PIN_SPRITE_W, height: LIVE_USER_PIN_SPRITE_H } }],
    { format: ImageManipulator.SaveFormat.PNG, compress: 0.9 },
  );
  return out.uri;
}

export const LiveUserPinSpriteCapture = memo(function LiveUserPinSpriteCapture({
  imageKey,
  data,
  onCapture,
}: Props) {
  const shotRef = useRef<ViewShot>(null);
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const readyRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const captureNow = useCallback(() => {
    const gen = genRef.current;
    if (busyRef.current || !readyRef.current) return;

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

  const handleVisualReady = useCallback(() => {
    readyRef.current = true;
    clearTimer();
    const gen = genRef.current;
    timerRef.current = setTimeout(() => {
      if (gen !== genRef.current) return;
      captureNow();
    }, READY_CAPTURE_DELAY_MS);
  }, [clearTimer, captureNow]);

  useEffect(() => {
    genRef.current += 1;
    busyRef.current = false;
    readyRef.current = false;
    clearTimer();
    return () => {
      genRef.current += 1;
      busyRef.current = false;
      readyRef.current = false;
      clearTimer();
    };
  }, [
    clearTimer,
    data.username,
    data.initials,
    data.avatarUrl,
    data.avatarFrameUrl,
    data.isPremium,
    data.isFriend,
    data.distanceLabel,
  ]);

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: LIVE_USER_PIN_SPRITE_W,
        height: LIVE_USER_PIN_SPRITE_H,
        opacity: 1,
        pointerEvents: 'none',
        overflow: 'hidden',
        backgroundColor: 'transparent',
      }}
    >
      <ViewShot
        ref={shotRef}
        options={{
          format: 'png',
          quality: 1,
          width: LIVE_USER_PIN_SPRITE_W,
          height: LIVE_USER_PIN_SPRITE_H,
        }}
        style={{ backgroundColor: 'transparent' }}
      >
        <LiveUserPinSpriteVisual data={data} onReady={handleVisualReady} />
      </ViewShot>
    </View>
  );
});
