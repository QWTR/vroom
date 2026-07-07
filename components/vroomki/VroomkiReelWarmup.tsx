import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { getMemoryCachedVroomkiVideoUri, peekCachedVroomkiVideoUri, priorityPrefetchVroomkiVideo } from '../../lib/vroomkiVideoCache';

/** Ukryty player — nagrzewa dekoder na następnym filmie zanim user doskroluje. */
export function VroomkiReelWarmup({ uri }: { uri: string | null }) {
  const ref = useRef<Video>(null);
  const [playbackUri, setPlaybackUri] = useState<string | null>(() => (uri ? getMemoryCachedVroomkiVideoUri(uri) : null));

  useEffect(() => {
    if (!uri) {
      setPlaybackUri(null);
      return;
    }

    const mem = getMemoryCachedVroomkiVideoUri(uri);
    if (mem) {
      setPlaybackUri(mem);
      return;
    }

    let cancelled = false;
    priorityPrefetchVroomkiVideo(uri);
    void peekCachedVroomkiVideoUri(uri).then((cached) => {
      if (!cancelled) setPlaybackUri(cached ?? uri);
    });

    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!playbackUri) return null;

  return (
    <Video
      ref={ref}
      source={{ uri: playbackUri }}
      style={styles.hidden}
      resizeMode={ResizeMode.COVER}
      shouldPlay={false}
      isMuted
      volume={0}
      useNativeControls={false}
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
    top: -9999,
  },
});
