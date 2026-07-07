import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  getMemoryCachedVroomkiVideoUri,
  peekCachedVroomkiVideoUri,
  prefetchVroomkiVideo,
} from '../../lib/vroomkiVideoCache';

const DOUBLE_TAP_MS = 280;

const warmedPostIds = new Set<number>();

export function isReelPostWarmed(postId: number) {
  return warmedPostIds.has(postId);
}

export function ReelVideo({
  postId,
  uri,
  active,
  muted = false,
  clipStartMs = 0,
  clipDurationMs = null,
  onCompleted,
  onDoubleTap,
  onMediaReadyChange,
  onClipLoop,
}: {
  postId: number;
  uri: string;
  active: boolean;
  muted?: boolean;
  clipStartMs?: number;
  clipDurationMs?: number | null;
  onCompleted: (watchMs: number) => void;
  onDoubleTap: () => void;
  onMediaReadyChange?: (ready: boolean) => void;
  onClipLoop?: () => void;
}) {
  const videoRef = useRef<Video>(null);
  const completedRef = useRef(false);
  const readyRef = useRef(false);
  const hasLoadedOnceRef = useRef(warmedPostIds.has(postId));
  const uriLockedRef = useRef(hasLoadedOnceRef.current);
  const lastUriRef = useRef<string | null>(null);
  const lastClipStartRef = useRef(clipStartMs);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pausedByUser, setPausedByUser] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(hasLoadedOnceRef.current);
  const [playbackUri, setPlaybackUri] = useState(() => getMemoryCachedVroomkiVideoUri(uri) ?? uri);

  const clipEndMs = clipDurationMs ? clipStartMs + clipDurationMs : null;
  const wasWarmed = warmedPostIds.has(postId);

  const reportReady = useCallback((ready: boolean) => {
    if (readyRef.current === ready) return;
    readyRef.current = ready;
    onMediaReadyChange?.(ready);
  }, [onMediaReadyChange]);

  useEffect(() => {
    const mem = getMemoryCachedVroomkiVideoUri(uri);
    if (mem) {
      setPlaybackUri(mem);
      uriLockedRef.current = true;
      return;
    }

    let cancelled = false;
    void peekCachedVroomkiVideoUri(uri).then((cached) => {
      if (cancelled || uriLockedRef.current || hasLoadedOnceRef.current) return;
      if (cached) {
        setPlaybackUri(cached);
        uriLockedRef.current = true;
      }
    });
    prefetchVroomkiVideo(uri);

    return () => {
      cancelled = true;
    };
  }, [uri]);

  useEffect(() => {
    if (!active) {
      setPausedByUser(false);
      videoRef.current?.pauseAsync().catch(() => {});
      return;
    }
    if (pausedByUser) {
      reportReady(false);
      videoRef.current?.pauseAsync().catch(() => {});
      return;
    }
    videoRef.current?.playAsync().catch(() => {});
  }, [active, pausedByUser, reportReady]);

  useEffect(() => {
    if (!active) return;

    const uriChanged = lastUriRef.current !== playbackUri;
    const clipChanged = lastClipStartRef.current !== clipStartMs;
    const needsSeek = uriChanged || clipChanged || !hasLoadedOnceRef.current;

    if (needsSeek) {
      completedRef.current = false;
      if (!hasLoadedOnceRef.current && !wasWarmed) reportReady(false);
      else reportReady(true);
      videoRef.current?.setPositionAsync(clipStartMs).catch(() => {});
      lastUriRef.current = playbackUri;
      lastClipStartRef.current = clipStartMs;
      return;
    }

    reportReady(true);
    videoRef.current?.playAsync().catch(() => {});
  }, [active, playbackUri, clipStartMs, reportReady, wasWarmed]);

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (!hasLoadedOnceRef.current && !wasWarmed) reportReady(false);
      return;
    }

    setPlaying(!!status.isPlaying);

    const position = status.positionMillis ?? 0;
    if (status.isPlaying || position > 0) {
      if (!hasLoadedOnceRef.current) {
        hasLoadedOnceRef.current = true;
        uriLockedRef.current = true;
        warmedPostIds.add(postId);
        setHasLoadedOnce(true);
      }
    }

    const isBuffering = !!status.isBuffering && !status.isPlaying;
    setBuffering(isBuffering);

    const isReady = active && !pausedByUser && (
      hasLoadedOnceRef.current || wasWarmed || (!isBuffering && (status.isPlaying || position >= 40))
    );
    reportReady(isReady);

    const duration = status.durationMillis ?? 0;

    if (clipEndMs && position >= clipEndMs - 80) {
      videoRef.current?.setPositionAsync(clipStartMs).catch(() => {});
      onClipLoop?.();
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleted(clipDurationMs ?? position);
      }
      return;
    }

    if (!completedRef.current && duration > 0 && position / duration >= 0.85) {
      completedRef.current = true;
      onCompleted(position);
    }
  }, [active, pausedByUser, clipEndMs, clipStartMs, clipDurationMs, onClipLoop, onCompleted, postId, reportReady, wasWarmed]);

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
    : active && !hasLoadedOnce && !wasWarmed && (buffering || !playing);

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={handlePress}>
      <Video
        ref={videoRef}
        source={{ uri: playbackUri }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay={active && !pausedByUser}
        isLooping={!clipEndMs}
        isMuted={muted}
        useNativeControls={false}
        progressUpdateIntervalMillis={500}
        onPlaybackStatusUpdate={onStatus}
        onReadyForDisplay={() => {
          if (!hasLoadedOnceRef.current) {
            hasLoadedOnceRef.current = true;
            uriLockedRef.current = true;
            warmedPostIds.add(postId);
            setHasLoadedOnce(true);
          }
          reportReady(true);
        }}
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
