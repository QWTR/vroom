import React, { memo, useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  DriveMarkerSpriteVisual,
  DRIVE_MARKER_SPRITE_SIZE,
  type DriveMarkerSpriteData,
} from './DriveMarkerSpriteVisual';

const READY_CAPTURE_DELAY_MS = 80;

export const DRIVE_MARKER_IMAGE_KEY = 'drive-marker-avatar';

type Props = {
  data: DriveMarkerSpriteData;
  onCapture: (uri: string) => void;
};

async function normalizeSpriteUri(rawUri: string): Promise<string> {
  const size = DRIVE_MARKER_SPRITE_SIZE;
  const out = await ImageManipulator.manipulateAsync(
    rawUri,
    [{ resize: { width: size, height: size } }],
    { format: ImageManipulator.SaveFormat.PNG, compress: 1.0 },
  );
  return out.uri;
}

export const DriveMarkerSpriteCapture = memo(function DriveMarkerSpriteCapture({
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
          onCapture(normalized);
        } catch {
          onCapture(uri);
        }
      })
      .catch(() => {})
      .finally(() => {
        busyRef.current = false;
      });
  }, [onCapture]);

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
    data.avatarUrl,
    data.imageUri,
    data.cursorSkin?.imageUrl,
    data.cursorSkin?.borderColor,
  ]);

  const size = DRIVE_MARKER_SPRITE_SIZE;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size,
        height: size,
        opacity: 0,
        zIndex: -9999,
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
          width: size,
          height: size,
        }}
        style={{ backgroundColor: 'transparent' }}
      >
        <DriveMarkerSpriteVisual data={data} onReady={handleVisualReady} />
      </ViewShot>
    </View>
  );
});
