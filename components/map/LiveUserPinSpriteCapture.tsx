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
  onCapture: (imageKey: string, uri: string, final: boolean) => void;
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
  const finalCaptureRef = useRef(false);
  const queuedCaptureRef = useRef(false);

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
    const finalCapture = finalCaptureRef.current;
    queuedCaptureRef.current = false;
    shotRef.current?.capture?.()
      .then(async (uri) => {
        if (gen !== genRef.current || !uri) return;
        try {
          const normalized = await normalizeSpriteUri(uri);
          if (gen !== genRef.current) return;
          onCapture(imageKey, normalized, finalCapture);
        } catch {
          onCapture(imageKey, uri, finalCapture);
        }
      })
      .catch(() => {})
      .finally(() => {
        busyRef.current = false;
        if (queuedCaptureRef.current) {
          timerRef.current = setTimeout(captureNow, READY_CAPTURE_DELAY_MS);
        }
      });
  }, [imageKey, onCapture]);

  const handleVisualReady = useCallback((final: boolean) => {
    readyRef.current = true;
    finalCaptureRef.current = finalCaptureRef.current || final;
    if (busyRef.current) {
      queuedCaptureRef.current = true;
      return;
    }
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
    finalCaptureRef.current = false;
    queuedCaptureRef.current = false;
    clearTimer();
    return () => {
      genRef.current += 1;
      busyRef.current = false;
      readyRef.current = false;
      finalCaptureRef.current = false;
      queuedCaptureRef.current = false;
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
    data.stale,
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
