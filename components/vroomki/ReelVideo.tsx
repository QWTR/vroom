import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  getMemoryCachedVroomkiVideoUri,
  peekCachedVroomkiVideoUri,
  prefetchVroomkiVideo,
} from '../../lib/vroomkiVideoCache';

const DOUBLE_TAP_MS = 280;

export function ReelVideo({
  uri,
  posterUri = null,
  active,
  onCompleted,
  onDoubleTap,
}: {
  uri: string;
  posterUri?: string | null;
  active: boolean;
  onCompleted: (watchMs: number) => void;
  onDoubleTap: () => void;
}) {
  const videoRef = useRef<Video>(null);
  const completedRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const uriLockedRef = useRef(false);
  const lastUriRef = useRef<string | null>(null);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(false);
  const bufferingRef = useRef(false);

  const [pausedByUser, setPausedByUser] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [playbackUri, setPlaybackUri] = useState(() => getMemoryCachedVroomkiVideoUri(uri) ?? uri);

  useEffect(() => {
    if (!active) return;

    const mem = getMemoryCachedVroomkiVideoUri(uri);
    if (mem && !uriLockedRef.current && !hasLoadedOnceRef.current) {
      setPlaybackUri(mem);
      return;
    }

    let cancelled = false;
    void peekCachedVroomkiVideoUri(uri).then((cached) => {
      if (cancelled || uriLockedRef.current || hasLoadedOnceRef.current) return;
      if (cached) setPlaybackUri(cached);
    });
    prefetchVroomkiVideo(uri);

    return () => {
      cancelled = true;
    };
  }, [uri, active]);

  useEffect(() => {
    if (!active) return;
    if (pausedByUser) {
      videoRef.current?.pauseAsync().catch(() => {});
      return;
    }
    videoRef.current?.playAsync().catch(() => {});
  }, [active, pausedByUser]);

  useEffect(() => {
    if (!active) return;

    const uriChanged = lastUriRef.current !== playbackUri;
    if (uriChanged || !hasLoadedOnceRef.current) {
      completedRef.current = false;
      videoRef.current?.setPositionAsync(0).catch(() => {});
      lastUriRef.current = playbackUri;
      return;
    }

    videoRef.current?.playAsync().catch(() => {});
  }, [active, playbackUri]);

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;

    const position = status.positionMillis ?? 0;
    if (status.isPlaying || position > 0) {
      uriLockedRef.current = true;
      if (!hasLoadedOnceRef.current) {
        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);
      }
    }

    const nextPlaying = !!status.isPlaying;
    if (playingRef.current !== nextPlaying) {
      playingRef.current = nextPlaying;
      setPlaying(nextPlaying);
    }

    const nextBuffering = !!status.isBuffering;
    if (bufferingRef.current !== nextBuffering) {
      bufferingRef.current = nextBuffering;
      setBuffering(nextBuffering);
    }

    const duration = status.durationMillis ?? 0;

    if (!completedRef.current && duration > 0 && position / duration >= 0.85) {
      completedRef.current = true;
      onCompleted(position);
    }
  }, [onCompleted]);

  const toggle = async () => {
    const nextPaused = !pausedByUser;
    setPausedByUser(nextPaused);
    try {
      if (nextPaused) await videoRef.current?.pauseAsync();
      else await videoRef.current?.playAsync();
    } catch {
      /* ignore */
    }
  };

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      lastTapRef.current = 0;
      onDoubleTap();
      return;
    }
    lastTapRef.current = now;
    singleTapTimerRef.current = setTimeout(() => {
      void toggle();
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => () => {
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
  }, []);

  const showLoader = pausedByUser
    ? true
    : active && !hasLoadedOnce && (buffering || !playing);

  if (!active) {
    return (
      <Pressable style={StyleSheet.absoluteFill} onPress={handlePress}>
        {posterUri ? (
          <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#050505' }]} />
        )}
      </Pressable>
    );
  }

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={handlePress}>
      <Video
        ref={videoRef}
        source={{ uri: playbackUri }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay={active && !pausedByUser}
        isLooping
        isMuted={false}
        useNativeControls={false}
        progressUpdateIntervalMillis={1000}
        onPlaybackStatusUpdate={onStatus}
      />
      {showLoader && (
        <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={styles.loaderBubble}>
            {pausedByUser ? (
              <MaterialIcons name="play-arrow" size={42} color="#fff" style={{ marginLeft: 3 }} />
            ) : (
              <ActivityIndicator color="#fff" />
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loaderBubble: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#0000008c',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
