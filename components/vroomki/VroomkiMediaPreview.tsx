import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, Dimensions } from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { VroomkiOverlays } from './VroomkiOverlays';
import type { VroomkiTextOverlay } from '../../lib/vroomkiTypes';

const { width: SCREEN_W } = Dimensions.get('window');

export function VroomkiMediaPreview({
  photos,
  video,
  height,
  width = SCREEN_W,
  active = true,
  photoDurationMs = 3000,
  clipStartMs = 0,
  clipDurationMs = null,
  overlays = [],
  muted = false,
  restartKey = 0,
  onMediaReadyChange,
}: {
  photos: string[];
  video: string | null;
  height: number;
  width?: number;
  active?: boolean;
  photoDurationMs?: number;
  clipStartMs?: number;
  clipDurationMs?: number | null;
  overlays?: VroomkiTextOverlay[];
  muted?: boolean;
  restartKey?: number | string;
  onMediaReadyChange?: (ready: boolean) => void;
}) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const videoRef = React.useRef<Video>(null);
  const readyRef = useRef(false);
  const clipEndMs = clipDurationMs ? clipStartMs + clipDurationMs : null;

  const reportReady = (ready: boolean) => {
    if (readyRef.current === ready) return;
    readyRef.current = ready;
    onMediaReadyChange?.(ready);
  };

  useEffect(() => {
    setPhotoIndex(0);
  }, [photos, video, restartKey]);

  useEffect(() => {
    if (video) return;
    reportReady(active);
  }, [video, active, onMediaReadyChange]);

  useEffect(() => {
    if (video || photos.length <= 1 || !active) return undefined;
    const timer = setInterval(() => {
      setPhotoIndex((prev) => (prev + 1) % photos.length);
    }, photoDurationMs);
    return () => clearInterval(timer);
  }, [video, photos, photoDurationMs, active, restartKey]);

  const handleVideoStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      reportReady(false);
      return;
    }

    const position = status.positionMillis ?? 0;
    const isReady = !status.isBuffering && (status.isPlaying || position >= 60);
    reportReady(isReady);

    if (!clipEndMs) return;
    if (position >= clipEndMs - 80) {
      videoRef.current?.setPositionAsync(clipStartMs).catch(() => {});
    }
  };

  useEffect(() => {
    if (!video || !active) return;
    readyRef.current = false;
    onMediaReadyChange?.(false);
    videoRef.current?.setPositionAsync(clipStartMs).catch(() => {});
  }, [video, active, clipStartMs, restartKey, onMediaReadyChange]);

  return (
    <View style={{ width, height, backgroundColor: '#050505', overflow: 'hidden' }} pointerEvents="box-none">
      {video ? (
        <Video
          ref={videoRef}
          key={`${video}-${restartKey}`}
          source={{ uri: video }}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          shouldPlay={active}
          isLooping={!clipEndMs}
          isMuted={muted}
          useNativeControls={false}
          progressUpdateIntervalMillis={200}
          onPlaybackStatusUpdate={handleVideoStatus}
        />
      ) : photos.length > 0 ? (
        <Image source={{ uri: photos[photoIndex] ?? photos[0] }} style={{ width, height }} resizeMode="cover" />
      ) : null}
      <VroomkiOverlays overlays={overlays} width={width} height={height} />
    </View>
  );
}
